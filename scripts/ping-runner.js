#!/usr/bin/env node

// Standalone script executed by OS schedulers (cron/launchd/schtasks).
// Must be self-contained — no imports from the compiled project.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.claude-shift');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LOG_FILE = path.join(CONFIG_DIR, 'ping.log');
const LOCK_FILE = path.join(CONFIG_DIR, 'ping.lock');
const SHELL_META = /[;&|`$(){}[\]!#~<>*?\n\r]/;

function log(msg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const safe = String(msg).replace(/[\n\r]/g, ' ');
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${safe}\n`, 'utf-8');
}

function acquireLock() {
  try {
    // Check stale lock
    try {
      const stat = fs.statSync(LOCK_FILE);
      if (Date.now() - stat.mtimeMs < 60000) {
        log('SKIP another ping is running (lock held)');
        process.exit(0);
      }
      fs.unlinkSync(LOCK_FILE);
    } catch {}
    // Atomic create — fails if file already exists
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function resolveExePath(name) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = execFileSync(cmd, [name], { encoding: 'utf-8', timeout: 5000 });
    const paths = result.trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (process.platform === 'win32') {
      const exe = paths.find(p => p.toLowerCase().endsWith('.exe'));
      if (exe) return exe;
    }
    return paths[0] || name;
  } catch {}
  return name;
}

function loadClaudePath() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(raw);
    if (typeof config?.settings?.claudePath === 'string' && config.settings.claudePath) {
      const p = config.settings.claudePath;
      if (path.isAbsolute(p)) return p;
      return resolveExePath(path.basename(p));
    }
  } catch {}
  return resolveExePath('claude');
}

async function main() {
  const triggerId = process.argv[2] || 'scheduled';

  if (!acquireLock()) {
    log(`ERROR trigger=${triggerId} could not acquire lock`);
    process.exit(1);
  }

  log(`PING trigger=${triggerId} status=starting`);
  const start = Date.now();

  try {
    const pty = await import('@lydell/node-pty');
    const claudePath = loadClaudePath();

    if (!claudePath || SHELL_META.test(claudePath)) {
      throw new Error(`Invalid claudePath: "${claudePath}"`);
    }

    const proc = pty.spawn(claudePath, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
    });

    let output = '';
    let sentMessage = false;
    let sentExit = false;

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch {}
      const duration = Date.now() - start;
      log(`PING trigger=${triggerId} status=success detail="timeout after ${duration}ms — session was started"`);
      releaseLock();
      process.exit(0);
    }, 30000);

    proc.onData((data) => {
      output += data;
      if (output.length > 1_000_000) return;
      if (!sentMessage && (output.includes('>') || output.includes('Claude'))) {
        sentMessage = true;
        setTimeout(() => {
          proc.write('ping\r');
        }, 1000);
      }
      if (sentMessage && !sentExit && output.length > 300) {
        sentExit = true;
        setTimeout(() => {
          proc.write('/exit\r');
        }, 2000);
      }
    });

    proc.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      const duration = Date.now() - start;
      const ok = exitCode === 0 || exitCode === null;
      log(`PING trigger=${triggerId} status=${ok ? 'success' : 'error'} detail="exit=${exitCode} duration=${duration}ms"`);
      releaseLock();
      process.exit(ok ? 0 : 1);
    });
  } catch (err) {
    const duration = Date.now() - start;
    log(`PING trigger=${triggerId} status=error detail="${err.message}" duration=${duration}ms`);
    releaseLock();
    process.exit(1);
  }
}

main();
