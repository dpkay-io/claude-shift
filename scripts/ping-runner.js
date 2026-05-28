#!/usr/bin/env node

// Standalone script executed by OS schedulers (cron/launchd/schtasks).
// Must be self-contained — no imports from the compiled project.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.claude-shift');
const LOG_FILE = path.join(CONFIG_DIR, 'ping.log');
const LOCK_FILE = path.join(CONFIG_DIR, 'ping.lock');

function log(msg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, 'utf-8');
}

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockAge = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
      if (lockAge < 60000) {
        log('SKIP another ping is running (lock held)');
        process.exit(0);
      }
      fs.unlinkSync(LOCK_FILE);
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
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
    // Use node-pty for interactive session
    const pty = await import('@lydell/node-pty');
    const claudePath = 'claude';

    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32'
      ? ['/c', claudePath]
      : ['-c', claudePath];

    const proc = pty.spawn(shell, args, {
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
      if (!sentMessage && (output.includes('>') || output.includes('Claude'))) {
        setTimeout(() => {
          proc.write('ping\r');
          sentMessage = true;
        }, 1000);
      }
      if (sentMessage && !sentExit && output.length > 300) {
        setTimeout(() => {
          proc.write('/exit\r');
          sentExit = true;
        }, 2000);
      }
    });

    proc.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      const duration = Date.now() - start;
      log(`PING trigger=${triggerId} status=success detail="exit=${exitCode} duration=${duration}ms"`);
      releaseLock();
      process.exit(0);
    });
  } catch (err) {
    const duration = Date.now() - start;
    log(`PING trigger=${triggerId} status=error detail="${err.message}" duration=${duration}ms`);
    releaseLock();
    process.exit(1);
  }
}

main();
