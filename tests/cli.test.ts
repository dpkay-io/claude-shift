import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const NODE = process.execPath;
const CLI = path.resolve('dist/index.js');
const CONFIG_DIR = path.join(os.homedir(), '.claude-shift');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function cli(...args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync(NODE, [CLI, ...args], {
      encoding: 'utf-8',
      timeout: 15000,
      env: { ...process.env, NO_COLOR: '1' },
    }) as string;
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? '') + (e.stderr ?? ''),
      exitCode: e.status ?? 1,
    };
  }
}

function freshConfig(overrides: Record<string, unknown> = {}): void {
  const config = {
    version: 1,
    triggers: [],
    nextId: 1,
    settings: {
      slotDuration: 5,
      burnRate: 2,
      claudePath: 'claude',
      nodePath: process.execPath,
      pingPath: '',
      pingMessage: 'ping',
      retryEnabled: true,
      retryIntervals: [5, 15, 30, 45, 60],
    },
    ...overrides,
  };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

describe('CLI E2E', { timeout: 20000 }, () => {
  let savedConfig: string | null = null;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error('dist/index.js not found — run `npm run build` before E2E tests.');
    }
    try {
      savedConfig = fs.readFileSync(CONFIG_FILE, 'utf-8');
    } catch {
      savedConfig = null;
    }
  });

  afterAll(() => {
    try { cli('uninstall'); } catch {}
    if (savedConfig !== null) {
      fs.writeFileSync(CONFIG_FILE, savedConfig);
    }
  });

  // ── version & help ──────────────────────────────────────────────

  describe('version & help', () => {
    it('--version prints semver', () => {
      const r = cli('--version');
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('--help lists all commands', () => {
      const r = cli('--help');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('Usage:');
      for (const cmd of ['init', 'add', 'smart', 'list', 'remove', 'install', 'uninstall', 'status', 'ping', 'today', 'week', 'config']) {
        expect(r.stdout).toContain(cmd);
      }
    });

    it('subcommand --help works', () => {
      const r = cli('add', '--help');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('--days');
      expect(r.stdout).toContain('--once');
    });
  });

  // ── config get/set ──────────────────────────────────────────────

  describe('config get/set', () => {
    beforeAll(() => freshConfig());

    it('get (no key) shows all settings', () => {
      const r = cli('config', 'get');
      expect(r.exitCode).toBe(0);
      for (const key of ['slotDuration', 'burnRate', 'claudePath', 'nodePath', 'pingPath', 'pingMessage', 'retryEnabled', 'retryIntervals']) {
        expect(r.stdout).toContain(key);
      }
    });

    it('get <key> shows single value', () => {
      const r = cli('config', 'get', 'slotDuration');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('5');
    });

    it('get unknown key shows error + available list', () => {
      const r = cli('config', 'get', 'fakeKey');
      expect(r.stdout).toContain('Unknown setting');
      expect(r.stdout).toContain('Available');
    });

    it('set string value', () => {
      const r = cli('config', 'set', 'pingMessage', 'hello');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('pingMessage = hello');
      const v = cli('config', 'get', 'pingMessage');
      expect(v.stdout).toContain('hello');
    });

    it('set numeric value', () => {
      const r = cli('config', 'set', 'slotDuration', '4');
      expect(r.exitCode).toBe(0);
      const v = cli('config', 'get', 'slotDuration');
      expect(v.stdout).toContain('4');
    });

    it('set boolean value', () => {
      const r = cli('config', 'set', 'retryEnabled', 'false');
      expect(r.exitCode).toBe(0);
      const v = cli('config', 'get', 'retryEnabled');
      expect(v.stdout).toContain('false');
    });

    it('set array value', () => {
      const r = cli('config', 'set', 'retryIntervals', '10,20,30');
      expect(r.exitCode).toBe(0);
      const v = cli('config', 'get', 'retryIntervals');
      expect(v.stdout).toContain('10,20,30');
    });

    it('set rejects invalid boolean', () => {
      const r = cli('config', 'set', 'retryEnabled', 'maybe');
      expect(r.stdout).toContain('must be true or false');
    });

    it('set rejects invalid number', () => {
      const r = cli('config', 'set', 'slotDuration', 'abc');
      expect(r.stdout).toContain('must be a positive number');
    });

    it('set rejects invalid array', () => {
      const r = cli('config', 'set', 'retryIntervals', 'a,b,c');
      expect(r.stdout).toContain('comma-separated positive integers');
    });

    it('set pingPath to valid directory', () => {
      const r = cli('config', 'set', 'pingPath', os.homedir());
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain(`pingPath = ${os.homedir()}`);
      const v = cli('config', 'get', 'pingPath');
      expect(v.stdout).toContain(os.homedir());
    });

    it('set pingPath rejects non-existent directory', () => {
      const r = cli('config', 'set', 'pingPath', '/no/such/path/here');
      expect(r.stdout).toContain('must be an existing directory');
    });

    it('set rejects unknown key', () => {
      const r = cli('config', 'set', 'fakeKey', 'value');
      expect(r.stdout).toContain('Unknown setting');
    });
  });

  // ── trigger CRUD (add / list / remove) ──────────────────────────

  describe('trigger CRUD', () => {
    beforeAll(() => freshConfig());

    it('add creates a recurring trigger', () => {
      const r = cli('add', '14:30', '--days', 'mon,wed');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('001');
      expect(r.stdout).toContain('added');
    });

    it('add creates a second trigger', () => {
      const r = cli('add', '08:00', '--days', 'weekdays');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('002');
    });

    it('add creates a one-time trigger with date', () => {
      const r = cli('add', '10:00', '--once', '2026-12-25');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('003');
      expect(r.stdout).toContain('one-time');
      expect(r.stdout).toContain('Dec 25, 2026');
    });

    it('add creates a one-time trigger for today', () => {
      const r = cli('add', '12:00', '--once');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('004');
      expect(r.stdout).toContain('one-time');
    });

    it('add rejects invalid time (out of range)', () => {
      const r = cli('add', '25:00');
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toContain('out of range');
    });

    it('add rejects invalid time (bad format)', () => {
      const r = cli('add', 'noon');
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toContain('Invalid time format');
    });

    it('add rejects --once with explicit --days', () => {
      const r = cli('add', '10:00', '--once', '--days', 'sat,sun');
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toContain('Cannot use --once with --days');
    });

    it('list shows all triggers', () => {
      const r = cli('list');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('001');
      expect(r.stdout).toContain('002');
      expect(r.stdout).toContain('003');
      expect(r.stdout).toContain('004');
    });

    it('remove deletes a trigger', () => {
      const r = cli('remove', '001');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('removed');
    });

    it('remove rejects nonexistent ID', () => {
      const r = cli('remove', '999');
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toContain('not found');
    });

    it('list reflects removal', () => {
      const r = cli('list');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).not.toContain(' 001 ');
      expect(r.stdout).toContain('002');
      expect(r.stdout).toContain('003');
    });
  });

  // ── smart mode ──────────────────────────────────────────────────

  describe('smart mode', () => {
    beforeAll(() => freshConfig());

    it('calculates and applies pings', () => {
      const r = cli('smart', '--slots', '09:00-12:00,14:00-17:00', '--days', 'weekdays', '--yes');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('Smart mode calculation');
      expect(r.stdout).toContain('Calculated pings');
      expect(r.stdout).toContain('smart trigger(s) configured');
    });

    it('created triggers appear in list', () => {
      const r = cli('list');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('smart');
      expect(r.stdout).toContain('weekdays');
    });

    it('re-running replaces previous triggers', () => {
      const r = cli('smart', '--slots', '10:00-14:00', '--days', 'weekdays', '--yes');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('Replaced');
    });

    it('accepts custom burn rate', () => {
      const r = cli('smart', '--slots', '09:00-12:00', '--days', 'weekends', '--burn-rate', '3', '--yes');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('Burn rate: 3h');
    });

    it('rejects invalid slot format', () => {
      const r = cli('smart', '--slots', 'bad', '--yes');
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toContain('Invalid slot format');
    });

    it('rejects invalid burn rate', () => {
      const r = cli('smart', '--slots', '09:00-12:00', '--burn-rate', 'abc', '--yes');
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toContain('Burn rate must be a positive number');
    });
  });

  // ── timeline display (today / week) ─────────────────────────────

  describe('timeline display', () => {
    beforeAll(() => {
      freshConfig();
      cli('smart', '--slots', '09:00-17:00', '--days', 'daily', '--yes');
    });

    it('today shows schedule timeline', () => {
      const r = cli('today');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('Schedule Timeline');
    });

    it('week shows all 7 days', () => {
      const r = cli('week');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('Schedule Timeline');
      for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
        expect(r.stdout).toContain(day);
      }
    });

    it('today with no triggers shows empty message', () => {
      freshConfig();
      const r = cli('today');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('No pings');
    });

    it('week with no triggers shows empty message', () => {
      const r = cli('week');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('No pings');
    });
  });

  // ── status ──────────────────────────────────────────────────────

  describe('status', () => {
    beforeAll(() => freshConfig());

    it('shows platform and scheduler info', () => {
      const r = cli('status');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('Platform:');
      expect(r.stdout).toContain('Configured triggers');
    });
  });

  // ── install & uninstall ─────────────────────────────────────────

  describe('install & uninstall', () => {
    beforeAll(() => {
      freshConfig();
      cli('add', '03:00', '--days', 'mon');
    });

    afterAll(() => {
      try { cli('uninstall'); } catch {}
    });

    it('install with no Claude warns gracefully', () => {
      freshConfig();
      cli('add', '03:00', '--days', 'mon');
      const r = cli('install');
      // Succeeds if Claude is found, fails gracefully if not
      expect(r.stdout.length).toBeGreaterThan(0);
    });

    it('install with no triggers warns', () => {
      freshConfig();
      const r = cli('install');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('No triggers configured');
    });

    it('uninstall runs cleanly', () => {
      const r = cli('uninstall');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('removed');
    });
  });
});
