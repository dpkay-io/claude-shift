import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakeClaude, type FakeClaude, type FakeClaudeSpec } from './helpers/fake-claude.js';

// End-to-end tests of scripts/ping-runner.js — the file OS schedulers actually run — against a fake
// claude, so they cost no usage. Like cli.test.ts it runs as an isolated instance (its own config
// dir and scheduler namespace) and needs a build first: `npm run test:e2e`.

const NODE = process.execPath;
const RUNNER = path.resolve('scripts/ping-runner.js');
const NAMESPACE = `runner-test-${process.pid}`;
const CONFIG_DIR = path.join(os.homedir(), `.claude-shift-${NAMESPACE}`);
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LOG_FILE = path.join(CONFIG_DIR, 'ping.log');
const LOCK_FILE = path.join(CONFIG_DIR, 'ping.lock');
const REAL_LOG_FILE = path.join(os.homedir(), '.claude-shift', 'ping.log');

const TRIGGER_ID = '001';
const PING_MESSAGE = 'ping from the runner test';
const TEST_TIMEOUT_MS = 40_000;
const DAYS_AHEAD_BEYOND_TODAY = 3;
const SECONDS_PER_DAY = 86_400;
const MINUTES_PER_DAY = 24 * 60;
const LATE_BY_MINUTES = 90;

const REAL_SUCCESS_LINES = fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-stream-success.jsonl'), 'utf-8').trim().split('\n');

const fakes: FakeClaude[] = [];
let pingDir: string;

function trigger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: TRIGGER_ID, time: '09:00', days: ['mon'], source: 'manual', enabled: true, ...overrides };
}

function setup(spec: FakeClaudeSpec, triggerOverrides: Record<string, unknown> = {}): FakeClaude {
  const claude = createFakeClaude(spec);
  fakes.push(claude);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    version: 1,
    triggers: [trigger(triggerOverrides)],
    nextId: 2,
    settings: {
      slotDuration: 5,
      burnRate: 2,
      claudePath: claude.command,
      nodePath: NODE,
      pingPath: pingDir,
      pingMessage: PING_MESSAGE,
      retryEnabled: false, // no retry tasks may be created in the OS scheduler by a test
      retryIntervals: [5],
    },
  }, null, 2));
  return claude;
}

function run(): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    execFile(NODE, [RUNNER, TRIGGER_ID, '--namespace', NAMESPACE], { timeout: 30_000, encoding: 'utf-8' }, (err, stdout, stderr) => {
      const code = (err as { code?: number | string } | null)?.code;
      resolve({ exitCode: err ? (typeof code === 'number' ? code : 1) : 0, output: `${stdout}${stderr}` });
    });
  });
}

const readLog = (): string => fs.readFileSync(LOG_FILE, 'utf-8');
const readConfig = (): { triggers: Array<{ enabled: boolean }> } => JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
const realLogSignature = (): string => {
  try { const s = fs.statSync(REAL_LOG_FILE); return `${s.size}:${s.mtimeMs}`; } catch { return 'absent'; }
};

describe('scripts/ping-runner.js (against a fake claude)', { timeout: TEST_TIMEOUT_MS }, () => {
  const realLogBefore = realLogSignature();

  beforeAll(() => {
    if (!fs.existsSync(path.resolve('dist/index.js'))) throw new Error('dist/ not found — run `npm run build` before E2E tests.');
    pingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-shift-ping-dir-'));
  });

  afterEach(() => {
    for (const f of fakes.splice(0)) f.dispose();
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(pingDir, { recursive: true, force: true });
    // An isolated run must never write to the user's real log.
    expect(realLogSignature()).toBe(realLogBefore);
  });

  it('logs a successful ping with its window, runs claude in pingPath and releases the lock', async () => {
    const claude = setup({ stdout: REAL_SUCCESS_LINES });
    const { exitCode } = await run();

    expect(exitCode).toBe(0);
    const log = readLog();
    expect(log).toMatch(/PING trigger=001 status=starting/);
    expect(log).toMatch(/PING trigger=001 status=success detail="exit=0 duration=\d+ms tokens=\d+ window=five_hour\(73%\) resets=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}" response="pong"/);

    const record = claude.readRecord();
    expect(record.stdin).toBe(PING_MESSAGE);
    expect(fs.realpathSync(record.cwd)).toBe(fs.realpathSync(pingDir));
    expect(fs.existsSync(LOCK_FILE)).toBe(false);
  });

  it('disables a one-time trigger after it succeeds', async () => {
    setup({ stdout: REAL_SUCCESS_LINES }, { date: '2026-11-09', days: [] });
    await run();
    expect(readConfig().triggers[0].enabled).toBe(false);
  });

  it('reports a failing claude as an error with the reason (after the plain-args retry), and exits 1', async () => {
    setup({ exitCode: 1, stderr: 'Error: Not logged in' });
    const { exitCode } = await run();

    expect(exitCode).toBe(1);
    const log = readLog();
    expect(log).toMatch(/PING trigger=001 status=error detail="exit=1 duration=\d+ms launch=full reason=process exited with code 1 - Error: Not logged in"/);
    expect(log).toMatch(/RETRY trigger=001 status=disabled/);
    expect(readConfig().triggers[0].enabled).toBe(true);
  });

  it('reports a rejected window as a limit and skips a retry whose reset is days away', async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + DAYS_AHEAD_BEYOND_TODAY * SECONDS_PER_DAY;
    setup({
      exitCode: 1,
      stdout: [
        JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', resetsAt } }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your weekly limit" }),
      ],
    });
    const { exitCode } = await run();

    expect(exitCode).toBe(1);
    const log = readLog();
    expect(log).toMatch(/PING trigger=001 status=limit-weekly detail="exit=1 duration=\d+ms window=seven_day resets=/);
    expect(log).toMatch(/RETRY trigger=001 status=skip detail="weekly limit . reset is on a future date/);
  });

  it('skips a disabled trigger without starting claude', async () => {
    const claude = setup({ stdout: REAL_SUCCESS_LINES }, { enabled: false });
    const { exitCode } = await run();

    expect(exitCode).toBe(0);
    expect(readLog()).toMatch(/SKIP trigger=001 disabled/);
    expect(() => claude.readRecord()).toThrow();
  });

  it('skips when another ping holds the lock', async () => {
    const claude = setup({ stdout: REAL_SUCCESS_LINES });
    fs.writeFileSync(LOCK_FILE, '999999');
    const { exitCode } = await run();

    expect(exitCode).toBe(0);
    expect(readLog()).toMatch(/SKIP another ping is running/);
    expect(() => claude.readRecord()).toThrow();
  });

  // The scheduler runs a missed start as soon as the PC is available; the log must show that it was late.
  const hhmmFromNow = (offsetMinutes: number): string => {
    const now = new Date();
    const total = (now.getHours() * 60 + now.getMinutes() + offsetMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  it('notes in the log when the scheduler started a trigger late (a catch-up run), and still pings', async () => {
    setup({ stdout: REAL_SUCCESS_LINES }, { time: hhmmFromNow(-LATE_BY_MINUTES) });
    const { exitCode } = await run();

    expect(exitCode).toBe(0);
    expect(readLog()).toMatch(/LATE trigger=001 detail="started 9\d min after its scheduled \d{2}:\d{2} \(catch-up run\)"/);
    expect(readLog()).toMatch(/PING trigger=001 status=success/);
  });

  it('does not note anything for a run that starts on time', async () => {
    setup({ stdout: REAL_SUCCESS_LINES }, { time: hhmmFromNow(0) });
    await run();
    expect(readLog()).not.toMatch(/LATE/);
  });
});
