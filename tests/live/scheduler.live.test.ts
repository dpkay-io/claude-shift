import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeClaude, type FakeClaude } from '../helpers/fake-claude.js';

// Live test: drives the real OS scheduler (launchd / Task Scheduler / cron) and waits for it to fire
// scripts/ping-runner.js, so it takes several minutes. It uses a fake claude, so it costs no usage,
// and runs as an isolated instance (its own config dir and scheduler namespace) that never touches
// the user's real triggers or tasks. Run with `npm run test:live`.
//
// Set CLAUDE_SHIFT_LIVE_REAL=1 to also send one real ping through the CLI (uses a little usage);
// CLAUDE_SHIFT_LIVE_CLAUDE=<path> picks which claude, otherwise the one on PATH.

const NODE = process.execPath;
const CLI = path.resolve('dist/index.js');
const NAMESPACE = `live-test-${process.pid}`;
const CONFIG_DIR = path.join(os.homedir(), `.claude-shift-${NAMESPACE}`);
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LOG_FILE = path.join(CONFIG_DIR, 'ping.log');
const REAL_CONFIG_DIR = path.join(os.homedir(), '.claude-shift');

const PING_MESSAGE = 'live test ping';
const MS_PER_MINUTE = 60_000;
// Schedulers fire on whole minutes and need the time to still be in the future when they register it.
const FIRST_TRIGGER_LEAD_MINUTES = 2;
const SECOND_TRIGGER_LEAD_MINUTES = 4;
// Past the retry's own lead time, plus the scheduler's polling slack.
const FIRE_TIMEOUT_MS = 8 * MS_PER_MINUTE;
const POLL_INTERVAL_MS = 5_000;
const TEST_TIMEOUT_MS = 20 * MS_PER_MINUTE;
const MINUTES_PER_DAY = 24 * 60;

const REAL_SUCCESS_LINES = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'claude-stream-success.jsonl'), 'utf-8').trim().split('\n');

interface Cli { stdout: string; exitCode: number }

function cli(...args: string[]): Promise<Cli> {
  return new Promise((resolve) => {
    execFile(NODE, [CLI, ...args], {
      encoding: 'utf-8',
      timeout: 120_000,
      env: { ...process.env, NO_COLOR: '1', CLAUDE_SHIFT_NAMESPACE: NAMESPACE },
    }, (err, stdout, stderr) => {
      const code = (err as { code?: number | string } | null)?.code;
      resolve({ stdout: `${stdout}${stderr}`, exitCode: err ? (typeof code === 'number' ? code : 1) : 0 });
    });
  });
}

async function waitFor<T>(what: string, probe: () => T | undefined | false, timeoutMs = FIRE_TIMEOUT_MS): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = probe();
    if (found) return found;
    if (Date.now() > deadline) {
      const hint = process.platform === 'linux' ? ' (on Linux/WSL the cron daemon must be running)' : '';
      throw new Error(`Timed out waiting for ${what}${hint}.\n--- ping.log ---\n${readLog() || '(empty)'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

const readLog = (): string => { try { return fs.readFileSync(LOG_FILE, 'utf-8'); } catch { return ''; } };
const logLine = (re: RegExp): string | undefined => readLog().split('\n').find((l) => re.test(l));
const readConfig = (): { triggers: Array<{ id: string; enabled: boolean }> } => JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
const pad = (n: number): string => String(n).padStart(2, '0');

function triggerTime(leadMinutes: number): string {
  const at = new Date(Date.now() + leadMinutes * MS_PER_MINUTE);
  if (at.getHours() * 60 + at.getMinutes() < leadMinutes + 1 || at.getHours() * 60 + at.getMinutes() >= MINUTES_PER_DAY - 20) {
    throw new Error('Too close to midnight for a same-day one-time trigger; run this test again a little later.');
  }
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

let claude: FakeClaude;
let pingDir: string;
let specFile: string;
const realConfigBefore = fs.existsSync(REAL_CONFIG_DIR) ? fs.readdirSync(REAL_CONFIG_DIR).sort().join(',') : 'absent';

function setFakeClaude(spec: { exitCode?: number; stderr?: string; stdout?: string[] }): void {
  fs.writeFileSync(specFile, JSON.stringify(spec));
}

describe('real OS scheduler (fake claude)', { timeout: TEST_TIMEOUT_MS }, () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI)) throw new Error('dist/index.js not found — run `npm run build` first.');
    pingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-shift-live-'));
    claude = createFakeClaude({ stdout: REAL_SUCCESS_LINES });
    specFile = path.join(path.dirname(claude.command), 'spec.json');
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      version: 1,
      triggers: [],
      nextId: 1,
      settings: {
        slotDuration: 5,
        burnRate: 2,
        claudePath: claude.command,
        nodePath: NODE,
        pingPath: pingDir,
        pingMessage: PING_MESSAGE,
        retryEnabled: true,
        retryIntervals: [1],
      },
    }, null, 2));
  });

  afterAll(async () => {
    try { await cli('uninstall'); } catch {}
    claude?.dispose();
    fs.rmSync(pingDir, { recursive: true, force: true });
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    // The isolated run must not have touched the user's real config directory.
    const after = fs.existsSync(REAL_CONFIG_DIR) ? fs.readdirSync(REAL_CONFIG_DIR).sort().join(',') : 'absent';
    expect(after).toBe(realConfigBefore);
  });

  it('registers two one-time triggers with the scheduler', async () => {
    expect((await cli('add', triggerTime(FIRST_TRIGGER_LEAD_MINUTES), '--once')).exitCode).toBe(0);
    expect((await cli('add', triggerTime(SECOND_TRIGGER_LEAD_MINUTES), '--once')).exitCode).toBe(0);

    const install = await cli('install');
    expect(install.exitCode).toBe(0);

    const status = (await cli('status')).stdout;
    expect(status).toMatch(/001 \(active\)/);
    expect(status).toMatch(/002 \(active\)/);
  });

  it('the scheduler fires the runner, which pings and logs a success', async () => {
    await waitFor('the first trigger to fire and succeed', () => logLine(/PING trigger=001 status=success/));

    const line = logLine(/PING trigger=001 status=success/)!;
    expect(line).toMatch(/exit=0 duration=\d+ms tokens=\d+ window=five_hour/);
    const record = claude.readRecord();
    expect(record.stdin).toBe(PING_MESSAGE);
    expect(fs.realpathSync(record.cwd)).toBe(fs.realpathSync(pingDir));
    expect(readConfig().triggers.find((t) => t.id === '001')?.enabled).toBe(false);

    const status = (await cli('status')).stdout;
    expect(status).toMatch(/Last successful ping: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('a failing ping schedules a retry; the retry fires, succeeds, and uninstall leaves nothing behind', async () => {
    // The second trigger fails first; flip the fake to success only after the failure is logged,
    // so the retry the scheduler runs later is the one that succeeds.
    setFakeClaude({ exitCode: 1, stderr: 'Error: Not logged in' });
    await waitFor('the second trigger to fire and fail', () => logLine(/PING trigger=002 status=error/));
    expect(logLine(/PING trigger=002 status=error/)).toMatch(/reason=process exited with code 1 - Error: Not logged in/);
    await waitFor('the retry to be scheduled', () => logLine(/RETRY trigger=002 status=scheduled/));
    setFakeClaude({ stdout: REAL_SUCCESS_LINES });

    expect((await cli('status')).stdout).toMatch(/retry-002-0 \(active\)/);

    await waitFor('the scheduled retry to fire and succeed', () => logLine(/PING trigger=002 retry=1 status=success/));

    const uninstall = await cli('uninstall');
    expect(uninstall.exitCode).toBe(0);
    const status = (await cli('status')).stdout;
    expect(status).not.toMatch(/\(active\)|\(inactive\)/);
  });

  it.runIf(process.env.CLAUDE_SHIFT_LIVE_REAL === '1')('sends one real ping through the CLI and logs its token cost', async (ctx) => {
    const real = process.env.CLAUDE_SHIFT_LIVE_CLAUDE ?? 'claude';
    expect((await cli('config', 'set', 'claudePath', real)).exitCode).toBe(0);
    const ping = await cli('ping');
    if (/usage limit hit/.test(ping.stdout)) ctx.skip(); // an exhausted window says nothing about the tool
    expect(ping.exitCode).toBe(0);
    expect(ping.stdout).toMatch(/Ping completed/);
    expect(logLine(/PING trigger=manual status=success/)).toMatch(/tokens=\d+ window=five_hour/);
  });
});
