import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildPingResult, pingLogEntry, type PingOutcome } from '../src/core/ping.js';
import { parseResetTime } from '../src/core/ping.js';
import { createStreamParser, type ClaudeRun } from '../src/core/claude-stream.js';

// Built in local time so the formatted log timestamp does not depend on the machine's timezone.
const RESET = new Date(2026, 10, 10, 2, 20, 0);

const okRun = (overrides: Partial<ClaudeRun> = {}): ClaudeRun => ({
  resultText: 'pong',
  isError: false,
  subtype: 'success',
  sawResponse: true,
  window: { type: 'five_hour', status: 'allowed', resetsAt: RESET, utilization: 0.73 },
  ...overrides,
});

const outcome = (overrides: Partial<PingOutcome> = {}): PingOutcome => ({
  run: okRun(),
  exitCode: 0,
  timedOut: false,
  durationMs: 1500,
  stderrTail: '',
  ...overrides,
});

describe('buildPingResult', () => {
  it('succeeds on exit 0 with a clean result and carries the window', () => {
    const r = buildPingResult(outcome());
    expect(r).toMatchObject({ success: true, duration: 1500, exitCode: 0, response: 'pong' });
    expect(r.error).toBeUndefined();
    expect(r.limitType).toBeUndefined();
    expect(r.window?.type).toBe('five_hour');
  });

  it('succeeds on exit 0 even if the stream had no result event', () => {
    expect(buildPingResult(outcome({ run: okRun({ resultText: undefined, subtype: undefined }) })).success).toBe(true);
  });

  it('fails when exit is 0 but the result is an error, and says why', () => {
    const r = buildPingResult(outcome({ run: okRun({ isError: true, resultText: 'Invalid API key', subtype: 'error_during_execution' }) }));
    expect(r.success).toBe(false);
    expect(r.error).toContain('Invalid API key');
  });

  it('fails on a non-zero exit and includes the exit code and stderr tail', () => {
    const r = buildPingResult(outcome({ exitCode: 1, run: okRun({ resultText: undefined, sawResponse: false, window: undefined }), stderrTail: 'Error: not logged in' }));
    expect(r.success).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.error).toContain('code 1');
    expect(r.error).toContain('not logged in');
  });

  it('reports a rejected five-hour window as a retryable session limit with its reset time', () => {
    const r = buildPingResult(outcome({
      exitCode: 1,
      run: okRun({ isError: true, resultText: 'limit', window: { type: 'five_hour', status: 'rejected', resetsAt: RESET } }),
    }));
    expect(r).toMatchObject({ success: false, limitType: 'session', resetTime: RESET });
  });

  it('maps a rejected seven-day window to a weekly limit', () => {
    const r = buildPingResult(outcome({ run: okRun({ window: { type: 'seven_day', status: 'rejected', resetsAt: RESET } }) }));
    expect(r).toMatchObject({ success: false, limitType: 'weekly', resetTime: RESET });
  });

  it('maps an unrecognised rejected window to an unknown limit', () => {
    const r = buildPingResult(outcome({ run: okRun({ window: { type: 'brand_new_window', status: 'rejected' } }) }));
    expect(r.limitType).toBe('unknown');
  });

  it('does not treat a warning or allowed window as a limit', () => {
    expect(buildPingResult(outcome({ run: okRun({ window: { type: 'five_hour', status: 'allowed_warning', resetsAt: RESET } }) })).success).toBe(true);
  });

  it('falls back to the reply text when no structured window says rejected', () => {
    const r = buildPingResult(outcome({
      exitCode: 1,
      run: okRun({ isError: true, window: undefined, resultText: "You've hit your weekly limit · resets Nov 15, 7:30pm" }),
    }));
    expect(r.limitType).toBe('weekly');
    expect(r.resetTime).toBeInstanceOf(Date);
    expect(r.success).toBe(false);
  });

  it('does not retry a monthly spend limit', () => {
    const r = buildPingResult(outcome({ run: okRun({ resultText: "You've hit your monthly spend limit" }) }));
    expect(r.limitType).toBe('monthly');
    expect(r.resetTime).toBeUndefined();
  });

  it('counts a timeout as success only if Claude had already responded', () => {
    const responded = buildPingResult(outcome({ timedOut: true, exitCode: null, run: okRun({ resultText: undefined }) }));
    expect(responded.success).toBe(true);

    const silent = buildPingResult(outcome({ timedOut: true, exitCode: null, run: okRun({ resultText: undefined, sawResponse: false, window: undefined }) }));
    expect(silent.success).toBe(false);
    expect(silent.error).toMatch(/timed out/i);
  });
});

describe('buildPingResult on a real limit capture', () => {
  const parser = createStreamParser();
  parser.push(fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-stream-limit.jsonl'), 'utf-8'));
  const run = parser.finish();

  it('reports a session limit with the reset time from Claude\'s own report', () => {
    const r = buildPingResult(outcome({ run, exitCode: 1 }));
    expect(r).toMatchObject({ success: false, limitType: 'session' });
    expect(r.resetTime).toEqual(new Date(1794257400 * 1000));
  });

  it('could not have got that reset time from the reply text, which carries no date', () => {
    expect(parseResetTime(run.resultText)).toBeNull();
  });
});

describe('pingLogEntry', () => {
  it('logs a successful ping with its exit, duration, window usage and reset', () => {
    const e = pingLogEntry(buildPingResult(outcome()));
    expect(e.status).toBe('success');
    expect(e.detail).toContain('exit=0');
    expect(e.detail).toContain('duration=1500ms');
    expect(e.detail).toContain('window=five_hour(73%)');
    expect(e.detail).toMatch(/resets=2026-11-10 02:20:00/);
    expect(e.response).toBe('pong');
  });

  it('logs the failure reason for an error', () => {
    const e = pingLogEntry(buildPingResult(outcome({ exitCode: 1, run: okRun({ resultText: undefined, sawResponse: false, window: undefined }), stderrTail: 'boom' })));
    expect(e.status).toBe('error');
    expect(e.detail).toContain('exit=1');
    expect(e.detail).toContain('boom');
  });

  it('logs a limit hit as limit-<type> with the reset time', () => {
    const e = pingLogEntry(buildPingResult(outcome({ run: okRun({ window: { type: 'five_hour', status: 'rejected', resetsAt: RESET } }) })));
    expect(e.status).toBe('limit-session');
    expect(e.detail).toMatch(/resets=2026-11-10 02:20:00/);
  });

  it('marks a timeout in the detail', () => {
    const e = pingLogEntry(buildPingResult(outcome({ timedOut: true, exitCode: null })));
    expect(e.detail).toContain('timeout');
  });
});
