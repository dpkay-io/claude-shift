import os from 'node:os';
import path from 'node:path';
import { logPing } from '../logger/index.js';
import { resolveExePath } from '../utils/claude-check.js';
import { SHELL_META, stripAnsi, toErrorMessage } from '../utils/text.js';
import { extractResponse, PTY_COLS, PTY_ROWS } from './response.js';

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

const KEY_ENTER = '\r';
const KEY_DOWN_ENTER = '\x1b[B\r';

// The trust dialog highlights its default option with "❯". Recent Claude versions default to
// "No, exit", so a bare Enter would quit — move to the other option first in that case.
export function trustDialogKeys(cleanOutput: string): string {
  const marks = [...cleanOutput.matchAll(/❯\s*(?:\d+\.\s*)?(yes|no)\b/gi)];
  const last = marks[marks.length - 1];
  return last && last[1].toLowerCase() === 'no' ? KEY_DOWN_ENTER : KEY_ENTER;
}

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

interface PtyHandles {
  _agent?: { _inSocket?: { destroy(): void }; _conoutSocketWorker?: { dispose(): void } };
}

// ponytail: node-pty 1.1.0 on Windows leaves the conin socket and conout worker open after the child
// exits, so the CLI never returns. kill() would fork a console-list helper that crashes once the child
// is gone, so release those two handles directly. Private fields: a node-pty upgrade that renames them
// turns this into a no-op — re-check `claude-shift ping` exits when bumping node-pty.
export function releasePty(proc: unknown): void {
  const agent = (proc as PtyHandles)._agent;
  agent?._inSocket?.destroy();
  agent?._conoutSocketWorker?.dispose();
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

      const isWinScript = process.platform === 'win32' &&
        /\.(cmd|bat)$/i.test(resolved);
      const spawnFile = isWinScript ? 'cmd.exe' : resolved;
      const spawnArgs = isWinScript ? ['/c', resolved] : [];

      const proc = pty.spawn(spawnFile, spawnArgs, {
        name: 'xterm-256color',
        cols: PTY_COLS,
        rows: PTY_ROWS,
        // Same fallback as scheduled pings (scripts/ping-runner.js), so a manual ping tests the same folder.
        cwd: cwd || os.homedir(),
      });

      let output = '';
      let sentMessage = false;
      let trustSeen = false;
      let readyTimer: ReturnType<typeof setTimeout> | null = null;

      // Single exit path for both the timeout and the process exit. `done` is claimed synchronously
      // so the kill() in the timeout path can't make onExit report the same ping twice.
      async function conclude(exitCode: number | null | undefined, timedOut: boolean): Promise<void> {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        const duration = Date.now() - start;
        let resp: string | undefined;
        try {
          resp = sentMessage ? (await extractResponse(output, message)) || undefined : undefined;
        } catch {}
        const detail = timedOut ? `timeout after ${duration}ms` : `exit=${exitCode} duration=${duration}ms`;
        const ok = timedOut || exitCode === 0 || exitCode === null;

        if (ok) {
          const limit = detectLimitHit(resp);
          if (limit) {
            const resetTime = limit.retryable ? parseResetTime(resp) : null;
            logPing(triggerId, `limit-${limit.type}`, detail, resp);
            resolve({ success: false, duration, error: `${limit.type} limit hit`, response: resp, limitType: limit.type, resetTime: resetTime ?? undefined });
            return;
          }
        }

        logPing(triggerId, ok ? 'success' : 'error', timedOut ? `${detail} — session was started` : detail, resp);
        resolve({ success: ok, duration, error: ok ? undefined : `process exited with code ${exitCode}`, response: resp });
      }

      const timeout = setTimeout(() => {
        try { proc.kill(); } catch {}
        // node-pty on Windows defers kill() until the pty's first output, so a child that never
        // printed anything would outlive it and keep this process open.
        if (!output) { try { process.kill(proc.pid); } catch {} }
        void conclude(undefined, true);
      }, 60000);

      function scheduleMessage(delayMs: number): void {
        if (readyTimer || sentMessage || done) return;
        readyTimer = setTimeout(() => {
          if (done || sentMessage) return;
          sentMessage = true;
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
        const clean = stripAnsi(output);

        if (!trustSeen && TRUST_RE.test(clean)) {
          trustSeen = true;
          if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
          setTimeout(() => {
            if (done) return;
            proc.write(trustDialogKeys(stripAnsi(output)));
            scheduleMessage(5000);
          }, 500);
          return;
        }

        if (!trustSeen && !sentMessage && clean.length > 200) {
          scheduleMessage(5000);
        }
      });

      proc.onExit(({ exitCode }) => {
        releasePty(proc);
        void conclude(exitCode, false);
      });
    });
  } catch (err) {
    const duration = Date.now() - start;
    const errMsg = toErrorMessage(err);
    logPing(triggerId, 'error', errMsg);
    return { success: false, duration, error: errMsg };
  }
}
