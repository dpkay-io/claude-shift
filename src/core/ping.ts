import path from 'node:path';
import { logPing } from '../logger/index.js';
import { resolveExePath } from '../utils/claude-check.js';
import { SHELL_META, ANSI_RE, stripAnsi, toErrorMessage } from '../utils/text.js';

export type LimitType = 'weekly' | 'monthly' | 'daily' | 'unknown';

export interface LimitHit {
  type: LimitType;
  retryable: boolean;
}

export interface PingResult {
  success: boolean;
  duration: number;
  error?: string;
  response?: string;
  limitType?: LimitType;
  resetTime?: Date;
}

const TRUST_RE = /trust\s*this\s*folder/i;

const MONTH_NAMES: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function detectLimitHit(response: string | undefined): LimitHit | null {
  if (!response) return null;
  const lower = response.toLowerCase();
  if (lower.includes('monthly spend limit') || lower.includes('monthly limit')) {
    return { type: 'monthly', retryable: false };
  }
  if (lower.includes('weekly limit')) {
    return { type: 'weekly', retryable: true };
  }
  if (lower.includes('daily limit')) {
    return { type: 'daily', retryable: true };
  }
  if (/(?:hit|reached|exceeded)\b.*\blimit\b|\blimit\b.*\b(?:hit|reached|exceeded)\b/i.test(response)) {
    return { type: 'unknown', retryable: true };
  }
  return null;
}

export function parseResetTime(response: string | undefined): Date | null {
  if (!response) return null;
  const match = response.match(/resets?\s+(\w+)\s+(\d{1,2}),?\s*(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!match) return null;
  const [, monthStr, dayStr, hourStr, minuteStr, ampm] = match;
  const month = MONTH_NAMES[monthStr.toLowerCase().slice(0, 3)];
  if (month === undefined) return null;
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
  const now = new Date();
  const resetDate = new Date(now.getFullYear(), month, parseInt(dayStr, 10), hour, minute, 0);
  if (resetDate.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    resetDate.setFullYear(resetDate.getFullYear() + 1);
  }
  return resetDate;
}

function extractResponse(rawOutput: string, message: string): string {
  let cleaned = rawOutput.replace(ANSI_RE, '');
  const msgIdx = cleaned.indexOf(message);
  if (msgIdx !== -1) cleaned = cleaned.slice(msgIdx + message.length);
  cleaned = cleaned
    .replace(/─+/g, '')
    .replace(/Resume this session with:.*$/gm, '')
    .replace(/claude\s+--resume\s+[\w-]+/g, '')
    .replace(/\d+\s*claude\.ai\s*connector.*?\/mcp/gi, '')
    .replace(/ctx:\d+%[^·]*?·\/effort/g, '')
    .replace(/\d+h:\d+%@[\w:.]+/g, '')
    .replace(/\d+d:\d+%@[\w:.]+/g, '')
    .replace(/[⠂⠐⠈⠑⠃]?\s*Claude Code\x07?/g, '')
    .replace(/[✻✳;]?\s*\w+(?:ed|ing)\s+for\s+\d+s/g, '')
    .replace(/\(\d+s\s*·\s*↓\s*\d+\s*tokens?\)/g, '')
    .replace(/(?:bypass\s*permissions?\s*on|shift\+tab\s*to\s*cycle)/gi, '')
    .replace(/[⏵●❯✻✳;]\s*/g, '')
    .replace(/~[\\/][\w\\/.-]+/g, '')
    .replace(/opus-\d+-\d+/g, '')
    .replace(/·\/effort/g, '')
    .replace(/\bhigh\b|\blow\b|\bmedium\b|\bmain\b/g, '')
    .replace(/\bX{1,2}\b/g, '')
    .replace(/\w+…/g, '')
    .replace(/u\d[u;][\d;a-z]*/gi, '')
    .replace(/\x07/g, '')
    .replace(/\/exit/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 500);
}

function validatePath(p: string): void {
  if (!p || SHELL_META.test(p)) {
    throw new Error(`Invalid executable path: "${p}"`);
  }
}

export async function executePing(claudePath: string, message: string, triggerId: string = 'manual', cwd?: string): Promise<PingResult> {
  validatePath(claudePath);
  const resolved = path.isAbsolute(claudePath) ? claudePath : resolveExePath(claudePath);
  const start = Date.now();
  try {
    const pty = await import('@lydell/node-pty');

    return new Promise<PingResult>((resolve) => {
      let done = false;
      function finish(result: PingResult): void {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(result);
      }

      const isWinScript = process.platform === 'win32' &&
        /\.(cmd|bat)$/i.test(resolved);
      const spawnFile = isWinScript ? 'cmd.exe' : resolved;
      const spawnArgs = isWinScript ? ['/c', resolved] : [];

      const proc = pty.spawn(spawnFile, spawnArgs, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: cwd || process.cwd(),
      });

      let output = '';
      let responseOutput = '';
      let sentMessage = false;
      let trustSeen = false;
      let readyTimer: ReturnType<typeof setTimeout> | null = null;

      const timeout = setTimeout(() => {
        try { proc.kill(); } catch {}
        const duration = Date.now() - start;
        const resp = responseOutput ? extractResponse(responseOutput, message) : undefined;
        const limit = detectLimitHit(resp);
        if (limit) {
          const resetTime = limit.retryable ? parseResetTime(resp) : null;
          logPing(triggerId, `limit-${limit.type}`, `timeout after ${duration}ms`, resp);
          finish({ success: false, duration, error: `${limit.type} limit hit`, response: resp, limitType: limit.type, resetTime: resetTime ?? undefined });
          return;
        }
        logPing(triggerId, 'success', `timeout after ${duration}ms — session was started`, resp);
        finish({ success: true, duration, response: resp });
      }, 60000);

      function scheduleMessage(delayMs: number): void {
        if (readyTimer || sentMessage || done) return;
        readyTimer = setTimeout(() => {
          if (done || sentMessage) return;
          sentMessage = true;
          responseOutput = '';
          proc.write(message + '\r');
          setTimeout(() => {
            if (done) return;
            proc.write('/exit\r');
          }, 12000);
        }, delayMs);
      }

      proc.onData((data: string) => {
        if (output.length > 1_000_000) return;
        output += data;
        if (sentMessage) responseOutput += data;
        const clean = stripAnsi(output);

        if (!trustSeen && TRUST_RE.test(clean)) {
          trustSeen = true;
          if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
          setTimeout(() => {
            if (done) return;
            proc.write('\r');
            scheduleMessage(5000);
          }, 500);
          return;
        }

        if (!trustSeen && !sentMessage && clean.length > 200) {
          scheduleMessage(5000);
        }
      });

      proc.onExit(({ exitCode }) => {
        const duration = Date.now() - start;
        const ok = exitCode === 0 || exitCode === null;
        const resp = responseOutput ? extractResponse(responseOutput, message) : undefined;

        if (ok) {
          const limit = detectLimitHit(resp);
          if (limit) {
            const resetTime = limit.retryable ? parseResetTime(resp) : null;
            logPing(triggerId, `limit-${limit.type}`, `exit=${exitCode} duration=${duration}ms`, resp);
            finish({ success: false, duration, error: `${limit.type} limit hit`, response: resp, limitType: limit.type, resetTime: resetTime ?? undefined });
            return;
          }
        }

        logPing(triggerId, ok ? 'success' : 'error', `exit=${exitCode} duration=${duration}ms`, resp);
        finish({ success: ok, duration, error: ok ? undefined : `process exited with code ${exitCode}`, response: resp });
      });
    });
  } catch (err) {
    const duration = Date.now() - start;
    const errMsg = toErrorMessage(err);
    logPing(triggerId, 'error', errMsg);
    return { success: false, duration, error: errMsg };
  }
}
