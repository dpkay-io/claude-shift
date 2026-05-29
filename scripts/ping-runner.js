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
const SHELL_META = /[;&|`${}[\]!#~<>*?\n\r]/;

function formatLocalTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function log(msg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const safe = String(msg).replace(/[\n\r]/g, ' ');
  fs.appendFileSync(LOG_FILE, `[${formatLocalTime(new Date())}] ${safe}\n`, 'utf-8');
}

const ANSI_RE = /\x1B(?:\[[0-9;]*[a-zA-Z]|\][^\x07]*\x07|\(B)/g;

function extractResponse(rawOutput, message) {
  let cleaned = rawOutput.replace(ANSI_RE, '');
  const msgIdx = cleaned.indexOf(message);
  if (msgIdx !== -1) cleaned = cleaned.slice(msgIdx + message.length);
  cleaned = cleaned.replace(/\/exit/g, '').replace(/[>❯]\s*/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 500);
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

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {}
  return null;
}

function loadClaudePath(config) {
  if (typeof config?.settings?.claudePath === 'string' && config.settings.claudePath) {
    const p = config.settings.claudePath;
    if (path.isAbsolute(p)) return p;
    if (p.includes(path.sep) || p.includes('/')) {
      return path.resolve(os.homedir(), p);
    }
    return resolveExePath(p);
  }
  return resolveExePath('claude');
}

function loadPingMessage(config) {
  if (typeof config?.settings?.pingMessage === 'string') {
    return config.settings.pingMessage;
  }
  return 'ping';
}

function disableOnceTrigger(triggerId) {
  try {
    const config = loadConfig();
    if (!config || !Array.isArray(config.triggers)) return;
    const trigger = config.triggers.find(t => t.id === triggerId);
    if (!trigger || !trigger.date) return;
    trigger.enabled = false;
    const tmpFile = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpFile, CONFIG_FILE);
    log(`ONCE trigger=${triggerId} auto-disabled after execution`);
  } catch {}
}

function sanitizeLog(s) {
  return String(s).replace(/[\n\r]/g, ' ').replace(/"/g, "'");
}

async function main() {
  const triggerId = process.argv[2] || 'scheduled';

  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });
  process.on('SIGINT', () => { releaseLock(); process.exit(0); });

  if (!acquireLock()) {
    log(`ERROR trigger=${triggerId} could not acquire lock`);
    process.exit(1);
  }

  log(`PING trigger=${triggerId} status=starting`);
  const start = Date.now();

  try {
    const pty = await import('@lydell/node-pty');
    const config = loadConfig();
    const claudePath = loadClaudePath(config);
    const message = loadPingMessage(config);

    if (!claudePath || SHELL_META.test(claudePath)) {
      throw new Error(`Invalid claudePath: "${claudePath}"`);
    }

    let done = false;
    const proc = pty.spawn(claudePath, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
    });

    let output = '';
    let responseOutput = '';
    let sentMessage = false;
    let sentExit = false;

    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill(); } catch {}
      const duration = Date.now() - start;
      const resp = responseOutput ? extractResponse(responseOutput, message) : '';
      const respPart = resp ? ` response="${sanitizeLog(resp)}"` : '';
      log(`PING trigger=${triggerId} status=success detail="timeout after ${duration}ms — session was started"${respPart}`);
      disableOnceTrigger(triggerId);
      releaseLock();
      process.exit(0);
    }, 30000);

    proc.onData((data) => {
      if (output.length > 1_000_000) return;
      output += data;
      if (sentMessage) responseOutput += data;
      const clean = output.replace(ANSI_RE, '');
      if (!sentMessage && (clean.endsWith('> ') || clean.endsWith('>') || clean.endsWith('❯ ') || clean.includes('\n> '))) {
        sentMessage = true;
        setTimeout(() => {
          if (done) return;
          proc.write(message + '\r');
        }, 1000);
      }
      if (sentMessage && !sentExit && responseOutput.length > 50) {
        sentExit = true;
        setTimeout(() => {
          if (done) return;
          proc.write('/exit\r');
        }, 2000);
      }
    });

    proc.onExit(({ exitCode }) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      const duration = Date.now() - start;
      const ok = exitCode === 0 || exitCode === null;
      const resp = responseOutput ? extractResponse(responseOutput, message) : '';
      const respPart = resp ? ` response="${sanitizeLog(resp)}"` : '';
      log(`PING trigger=${triggerId} status=${ok ? 'success' : 'error'} detail="exit=${exitCode} duration=${duration}ms"${respPart}`);
      if (ok) disableOnceTrigger(triggerId);
      releaseLock();
      process.exit(ok ? 0 : 1);
    });
  } catch (err) {
    const duration = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`PING trigger=${triggerId} status=error detail="${sanitizeLog(errMsg)}" duration=${duration}ms`);
    releaseLock();
    process.exit(1);
  }
}

main();
