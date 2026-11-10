import { execFile, spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { resolveExePath } from '../utils/claude-check.js';
import { claudeSpawnTarget, type SpawnTarget } from '../utils/spawn-target.js';
import { SHELL_META, toErrorMessage } from '../utils/text.js';
import { createStreamParser, type ClaudeRun, type RateLimitWindow } from './claude-stream.js';
import { formatLocalDateTime } from './time-utils.js';

// This module is shared by the CLI and by scripts/ping-runner.js (run by OS schedulers), so it must
// stay free of side effects at import time: no config or log paths, no logging. Callers log.

export type LimitType = 'session' | 'weekly' | 'monthly' | 'daily' | 'unknown';

export interface LimitHit {
  type: LimitType;
  retryable: boolean;
}

export interface PingResult {
  success: boolean;
  duration: number;
  /** Exit code of claude; null when it was killed, undefined when it never started. */
  exitCode?: number | null;
  error?: string;
  response?: string;
  limitType?: LimitType;
  resetTime?: Date;
  /** Tokens Claude read for this ping (fresh + cached input). */
  promptTokens?: number;
  /** The rate-limit window Claude reported for this request (proves which window the ping counted against). */
  window?: RateLimitWindow;
  timedOut?: boolean;
  /** The lean launch was rejected before Claude responded, so the ping was re-run with plain arguments. */
  launchFallback?: boolean;
}

export interface PingOptions {
  timeoutMs?: number;
}

/** Everything observed about one claude run, before it is turned into a PingResult. */
export interface PingOutcome {
  run: ClaudeRun;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stderrTail: string;
}

export interface PingLogEntry {
  status: string;
  detail: string;
  response?: string;
}

export const PING_TIMEOUT_MS = 120_000;

// Print mode needs no terminal and no folder-trust prompt, and its event stream reports the
// rate-limit window. The message goes in on stdin so it never meets a shell or cmd.exe parser.
export const CLAUDE_BASE_ARGS = ['-p', '--output-format', 'stream-json', '--verbose'];

// A ping only has to reach the API, so launch Claude without what it would normally load for a
// session: customizations (CLAUDE.md, skills, plugins, hooks, MCP servers), the tool definitions,
// and the long default system prompt. Measured on a real account this cut a ping from about
// 26-36K prompt tokens to 0.6-2K. The empty string after --tools means "no tools" and must stay a
// separate argument. Claude versions that predate a flag reject it, hence the plain-args retry.
export const PING_SYSTEM_PROMPT = 'You are a connectivity check. Answer as briefly as possible.';
export const CLAUDE_LEAN_ARGS = ['--safe-mode', '--tools', '', '--system-prompt', PING_SYSTEM_PROMPT];
const STDERR_TAIL_CHARS = 1000;
const MIN_RETRY_TIMEOUT_MS = 1000;
const REJECTED_STATUS = 'rejected';
const FIVE_HOUR_WINDOW = 'five_hour';
const SEVEN_DAY_WINDOW_PREFIX = 'seven_day';
const PERCENT = 100;

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

function windowLimitType(windowType: string): LimitType {
  if (windowType === FIVE_HOUR_WINDOW) return 'session';
  if (windowType.startsWith(SEVEN_DAY_WINDOW_PREFIX)) return 'weekly';
  return 'unknown';
}

// Claude's own rate-limit report is authoritative; the wording of the reply is only a fallback.
function findLimit(run: ClaudeRun): { hit: LimitHit; resetTime?: Date } | null {
  const window = run.window;
  if (window?.status === REJECTED_STATUS) {
    return { hit: { type: windowLimitType(window.type), retryable: true }, resetTime: window.resetsAt };
  }
  const hit = detectLimitHit(run.resultText);
  if (!hit) return null;
  return { hit, resetTime: hit.retryable ? parseResetTime(run.resultText) ?? undefined : undefined };
}

function failureReason({ run, exitCode, stderrTail }: PingOutcome): string {
  const exit = exitCode === null
    ? 'claude was terminated before it finished'
    : exitCode !== 0
      ? `process exited with code ${exitCode}`
      : 'claude reported an error';
  const apiStatus = run.apiErrorStatus !== undefined ? `api status ${run.apiErrorStatus}` : undefined;
  return [exit, run.resultText, apiStatus, stderrTail.trim()].filter(Boolean).join(' - ');
}

/** Turns what was observed about a claude run into the ping's verdict. Pure, so it is easy to test. */
export function buildPingResult(outcome: PingOutcome): PingResult {
  const { run, exitCode, timedOut, durationMs } = outcome;
  const base = { duration: durationMs, exitCode, response: run.resultText, promptTokens: run.promptTokens, window: run.window, timedOut: timedOut || undefined };

  const limit = findLimit(run);
  if (limit) {
    return { ...base, success: false, limitType: limit.hit.type, resetTime: limit.resetTime, error: `${limit.hit.type} limit hit` };
  }
  if (timedOut) {
    // A response before the kill means the request reached the API, which is all a ping is for.
    return run.sawResponse
      ? { ...base, success: true }
      : { ...base, success: false, error: `timed out after ${Math.round(durationMs / 1000)}s without a response from claude` };
  }
  if (exitCode === 0 && !run.isError) return { ...base, success: true };
  return { ...base, success: false, error: failureReason(outcome) };
}

/** The status/detail/response fields for one ping.log line, shared by the CLI and the scheduled runner. */
export function pingLogEntry(result: PingResult): PingLogEntry {
  const status = result.limitType ? `limit-${result.limitType}` : result.success ? 'success' : 'error';
  const parts = [`exit=${result.exitCode ?? 'none'}`, `duration=${result.duration}ms`];
  if (result.promptTokens !== undefined) parts.push(`tokens=${result.promptTokens}`);
  if (result.timedOut) parts.push('timeout');
  if (result.launchFallback) parts.push('launch=full');
  if (result.window) {
    const used = result.window.utilization;
    parts.push(`window=${result.window.type}${used !== undefined ? `(${Math.round(used * PERCENT)}%)` : ''}`);
  }
  const resets = result.resetTime ?? result.window?.resetsAt;
  if (resets) parts.push(`resets=${formatLocalDateTime(resets)}`);
  if (!result.success && !result.limitType && result.error) parts.push(`reason=${result.error}`);
  return { status, detail: parts.join(' '), response: result.response };
}

function validatePath(p: string): void {
  if (!p || SHELL_META.test(p)) {
    throw new Error(`Invalid executable path: "${p}"`);
  }
}

// Wrapper scripts (claude.cmd) leave the real process running if only the wrapper is killed, so on
// Windows take down the whole tree. Killing the wrapper first would orphan the tree taskkill walks.
function killProcessTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, (err) => {
      if (err) { try { child.kill(); } catch {} }
    });
    return;
  }
  try { child.kill('SIGKILL'); } catch {}
}

// Claude exited without ever answering (and was not just slow): the likeliest cause is an
// option this Claude version does not know, so it is worth one retry without the lean flags.
const launchRejected = (o: PingOutcome): boolean => !o.timedOut && o.exitCode !== 0 && !o.run.sawResponse;

/** Runs claude once and reports what was observed. Resolves with a start error if it cannot be launched. */
function runClaude(claudeFile: string, extraArgs: string[], message: string, cwd: string | undefined, timeoutMs: number): Promise<PingOutcome | { startError: string }> {
  const start = Date.now();
  const parser = createStreamParser();

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stderrTail = '';
    let target: SpawnTarget;
    try {
      target = claudeSpawnTarget(claudeFile, [...CLAUDE_BASE_ARGS, ...extraArgs]);
    } catch (err) {
      resolve({ startError: toErrorMessage(err) });
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (value: PingOutcome | { startError: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = (err: unknown): void => settle({ startError: `Could not start claude (${claudeFile}): ${toErrorMessage(err)}` });
    const finish = (exitCode: number | null): void =>
      settle({ run: parser.finish(), exitCode, timedOut, durationMs: Date.now() - start, stderrTail });

    let child: ChildProcess;
    try {
      child = spawn(target.file, target.args, {
        cwd: cwd || os.homedir(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: target.windowsVerbatimArguments,
      });
    } catch (err) {
      fail(err);
      return;
    }

    child.once('error', fail);
    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => parser.push(chunk));
    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', (chunk: string) => { stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS); });
    // Claude may exit before it reads stdin (bad install, not logged in); that is reported via its exit code.
    child.stdin?.on('error', () => {});
    child.stdin?.end(message);
    child.once('close', (code) => finish(code));

    timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
      finish(null);
    }, timeoutMs);
  });
}

/** Sends `message` to Claude in print mode and reports what happened. Never throws and never logs. */
export async function executePing(claudePath: string, message: string, cwd?: string, options: PingOptions = {}): Promise<PingResult> {
  try {
    validatePath(claudePath);
  } catch (err) {
    return { success: false, duration: 0, error: toErrorMessage(err) };
  }

  const resolved = path.isAbsolute(claudePath) ? claudePath : resolveExePath(claudePath);
  const timeoutMs = options.timeoutMs ?? PING_TIMEOUT_MS;
  const start = Date.now();

  let attempt = await runClaude(resolved, CLAUDE_LEAN_ARGS, message, cwd, timeoutMs);
  let launchFallback = false;
  if (!('startError' in attempt) && launchRejected(attempt)) {
    launchFallback = true;
    // The retry shares the original deadline, so a ping never runs longer than one timeout in total.
    attempt = await runClaude(resolved, [], message, cwd, Math.max(timeoutMs - (Date.now() - start), MIN_RETRY_TIMEOUT_MS));
  }

  if ('startError' in attempt) return { success: false, duration: Date.now() - start, error: attempt.startError };
  const result = buildPingResult({ ...attempt, durationMs: Date.now() - start });
  return launchFallback ? { ...result, launchFallback } : result;
}
