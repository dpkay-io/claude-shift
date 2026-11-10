import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLAUDE_BASE_ARGS, CLAUDE_LEAN_ARGS, executePing } from '../src/core/ping.js';
import { createFakeClaude, type FakeClaude, type FakeClaudeSpec } from './helpers/fake-claude.js';

const REAL_SUCCESS_LINES = fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-stream-success.jsonl'), 'utf-8').trim().split('\n');
const LEAN_LAUNCH_ARGS = [...CLAUDE_BASE_ARGS, ...CLAUDE_LEAN_ARGS];
// Shell metacharacters that would break a message passed on a Windows command line.
const AWKWARD_MESSAGE = 'ping & echo "hi" | find > out.txt %PATH% ^ !';
const SHORT_TIMEOUT_MS = 1500;
const TEST_TIMEOUT_MS = 20_000;

const fakes: FakeClaude[] = [];
function fake(spec: FakeClaudeSpec): FakeClaude {
  const f = createFakeClaude(spec);
  fakes.push(f);
  return f;
}
afterEach(() => { for (const f of fakes.splice(0)) f.dispose(); });

describe('executePing (against a fake claude)', () => {
  it('sends the message on stdin, runs in print mode, and reads the real stream', async () => {
    const claude = fake({ stdout: REAL_SUCCESS_LINES });
    const result = await executePing(claude.command, AWKWARD_MESSAGE);

    expect(result.success).toBe(true);
    expect(result.response).toBe('pong');
    expect(result.exitCode).toBe(0);
    expect(result.window).toMatchObject({ type: 'five_hour', status: 'allowed' });

    const record = claude.readRecord();
    expect(record.argv).toEqual(LEAN_LAUNCH_ARGS);
    expect(record.runs).toBe(1);
    expect(record.stdin).toBe(AWKWARD_MESSAGE);
  }, TEST_TIMEOUT_MS);

  it('launches claude lean: no tools, no customizations, a minimal system prompt', () => {
    expect(CLAUDE_LEAN_ARGS).toEqual(expect.arrayContaining(['--safe-mode', '--tools', '', '--system-prompt']));
    // The empty value must be its own argument, or claude would treat the next flag as the tool list.
    expect(CLAUDE_LEAN_ARGS[CLAUDE_LEAN_ARGS.indexOf('--tools') + 1]).toBe('');
  });

  it('delivers the empty --tools argument intact through the launcher (cmd.exe shim on Windows)', async () => {
    const claude = fake({ stdout: REAL_SUCCESS_LINES });
    await executePing(claude.command, 'ping');
    const argv = claude.readRecord().argv;
    expect(argv[argv.indexOf('--tools') + 1]).toBe('');
  }, TEST_TIMEOUT_MS);

  it('retries once with plain arguments when an older claude rejects the lean flags', async () => {
    const claude = fake({ stdout: REAL_SUCCESS_LINES, rejectFlag: '--safe-mode' });
    const result = await executePing(claude.command, 'ping');

    expect(result.success).toBe(true);
    expect(result.launchFallback).toBe(true);
    const record = claude.readRecord();
    expect(record.runs).toBe(2);
    expect(record.argv).toEqual(CLAUDE_BASE_ARGS);
    expect(record.stdin).toBe('ping');
  }, TEST_TIMEOUT_MS);

  it('does not retry when claude responded, e.g. a rate limit', async () => {
    const claude = fake({
      exitCode: 1,
      stdout: [JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } })],
    });
    const result = await executePing(claude.command, 'ping');
    expect(result.limitType).toBe('session');
    expect(result.launchFallback).toBeUndefined();
    expect(claude.readRecord().runs).toBe(1);
  }, TEST_TIMEOUT_MS);

  it('retries a failure with no response once, then reports it (it may be the lean flags)', async () => {
    const claude = fake({ exitCode: 1, stderr: 'Error: Not logged in' });
    const result = await executePing(claude.command, 'ping');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not logged in');
    expect(claude.readRecord().runs).toBe(2);
  }, TEST_TIMEOUT_MS);

  it('runs claude in the requested folder', async () => {
    const claude = fake({ stdout: REAL_SUCCESS_LINES });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-shift-cwd-'));
    try {
      await executePing(claude.command, 'ping', dir);
      expect(fs.realpathSync(claude.readRecord().cwd)).toBe(fs.realpathSync(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('falls back to the home directory when no folder is given', async () => {
    const claude = fake({ stdout: REAL_SUCCESS_LINES });
    await executePing(claude.command, 'ping');
    expect(fs.realpathSync(claude.readRecord().cwd)).toBe(fs.realpathSync(os.homedir()));
  }, TEST_TIMEOUT_MS);

  it('reports a non-zero exit with the exit code and what claude wrote to stderr', async () => {
    const claude = fake({ exitCode: 1, stderr: 'Error: Not logged in' });
    const result = await executePing(claude.command, 'ping');
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('code 1');
    expect(result.error).toContain('Not logged in');
  }, TEST_TIMEOUT_MS);

  it('reports a rejected rate-limit window as a limit with its reset time', async () => {
    const resetsAtSeconds = Math.floor(Date.now() / 1000) + 3600;
    const claude = fake({
      exitCode: 1,
      stdout: [
        JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: resetsAtSeconds } }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your limit" }),
      ],
    });
    const result = await executePing(claude.command, 'ping');
    expect(result.success).toBe(false);
    expect(result.limitType).toBe('session');
    expect(result.resetTime?.getTime()).toBe(resetsAtSeconds * 1000);
  }, TEST_TIMEOUT_MS);

  it('kills a hung claude at the timeout and fails when it never responded', async () => {
    const claude = fake({ hangMs: 60_000 });
    const started = Date.now();
    const result = await executePing(claude.command, 'ping', undefined, { timeoutMs: SHORT_TIMEOUT_MS });
    expect(Date.now() - started).toBeLessThan(SHORT_TIMEOUT_MS + 8000);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  }, TEST_TIMEOUT_MS);

  it('counts a timeout as success when claude had already answered', async () => {
    const claude = fake({ stdout: REAL_SUCCESS_LINES.slice(0, 4), hangMs: 60_000 });
    const result = await executePing(claude.command, 'ping', undefined, { timeoutMs: SHORT_TIMEOUT_MS });
    expect(result.success).toBe(true);
  }, TEST_TIMEOUT_MS);

  it('fails cleanly when the binary cannot be started', async () => {
    const result = await executePing(path.join(os.tmpdir(), 'claude-shift-no-such-binary', 'claude'), 'ping');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  }, TEST_TIMEOUT_MS);

  it('rejects an executable path with shell metacharacters', async () => {
    const result = await executePing('claude; rm -rf /', 'ping');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid executable path/i);
  });
});
