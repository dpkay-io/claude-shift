#!/usr/bin/env node

// Standalone script executed by OS schedulers (cron/launchd/schtasks).
// Must be self-contained — no imports from the compiled project.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

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

// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\x1B\x9B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g;
const TRUST_RE = /trust\s*this\s*folder/i;

function extractResponse(rawOutput, message) {
  let cleaned = rawOutput.replace(ANSI_RE, '');
  const msgIdx = cleaned.indexOf(message);
  if (msgIdx !== -1) cleaned = cleaned.slice(msgIdx + message.length);
  cleaned = cleaned
    .replace(/─+/g, '')
    .replace(/Resume this session with:.*$/gm, '')
    .replace(/claude\s+--resume\s+[\w-]+/g, '')
    .replace(/\d+\s*claude\.ai\s*connector.*?\/mcp/gi, '')
    .replace(/ctx:\d+%[^·]*?·\/effort/g, '')
    .replace(/\d+h:\d+%@[\w:.]+/g, '')
    .replace(/\d+d:\d+%@[\w:.]+/g, '')
    .replace(/[⠂⠐⠈⠑⠃]?\s*Claude Code\x07?/g, '')
    .replace(/[✻✳;]?\s*\w+(?:ed|ing)\s+for\s+\d+s/g, '')
    .replace(/\(\d+s\s*·\s*↓\s*\d+\s*tokens?\)/g, '')
    .replace(/(?:bypass\s*permissions?\s*on|shift\+tab\s*to\s*cycle)/gi, '')
    .replace(/[⏵●❯✻✳;]\s*/g, '')
    .replace(/~[\\/][\w\\/.-]+/g, '')
    .replace(/opus-\d+-\d+/g, '')
    .replace(/·\/effort/g, '')
    .replace(/\bhigh\b|\blow\b|\bmedium\b|\bmain\b/g, '')
    .replace(/\bX{1,2}\b/g, '')
    .replace(/\w+…/g, '')
    .replace(/u\d[u;][\d;a-z]*/gi, '')
    .replace(/\x07/g, '')
    .replace(/\/exit/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 500);
}

function acquireLock() {
  try {
    try {
      const stat = fs.statSync(LOCK_FILE);
      if (Date.now() - stat.mtimeMs < 60000) {
        return 'held';
      }
      fs.unlinkSync(LOCK_FILE);
    } catch {}
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return 'acquired';
  } catch {
    return 'failed';
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function commonClaudePaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      path.join(home, 'AppData', 'Local', 'Programs', 'claude-code', 'claude.exe'),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      path.join(home, '.npm-global', 'bin', 'claude'),
      path.join(home, '.local', 'bin', 'claude'),
    ];
  }
  return [
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
  ];
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
    const resolved = resolveExePath(p);
    if (resolved !== p) return resolved;
  } else {
    const resolved = resolveExePath('claude');
    if (resolved !== 'claude') return resolved;
  }

  for (const candidate of commonClaudePaths()) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return 'claude';
}

function loadPingMessage(config) {
  if (typeof config?.settings?.pingMessage === 'string') {
    return config.settings.pingMessage;
  }
  return 'ping';
}

function loadPingPath(config) {
  if (typeof config?.settings?.pingPath === 'string' && config.settings.pingPath) {
    const p = config.settings.pingPath;
    if (fs.existsSync(p)) return p;
  }
  return os.homedir();
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

// --- Retry helpers ---

function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentDayOfWeek() {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
}

function findConflictingTrigger(config, triggerId, originalTime, retryTime) {
  const today = currentDayOfWeek();
  const todayDate = todayDateStr();
  const origMin = timeToMinutes(originalTime);
  const retryMin = timeToMinutes(retryTime);

  if (!config || !Array.isArray(config.triggers)) return null;

  for (const trigger of config.triggers) {
    if (!trigger.enabled || trigger.id === triggerId) continue;
    const appliesToday = trigger.date
      ? trigger.date === todayDate
      : Array.isArray(trigger.days) && trigger.days.includes(today);
    if (!appliesToday) continue;

    const trigMin = timeToMinutes(trigger.time);
    if (trigMin > origMin && trigMin <= retryMin) return trigger;
  }
  return null;
}

function parseCommandArgs(cmd) {
  const args = [];
  let current = '';
  let inQuote = false;
  for (const ch of cmd) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ' ' && !inQuote) { if (current) args.push(current); current = ''; }
    else { current += ch; }
  }
  if (current) args.push(current);
  return args;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function scheduleOsTask(taskId, taskTime, command) {
  const date = todayDateStr();
  if (process.platform === 'win32') {
    const [y, m, d] = date.split('-');
    const sd = `${m}/${d}/${y}`;
    const name = `claude-shift-${taskId}`;
    try { execFileSync('schtasks', ['/delete', '/tn', name, '/f'], { stdio: 'pipe', timeout: 15000 }); } catch {}
    execFileSync('schtasks', ['/create', '/tn', name, '/tr', command, '/sc', 'ONCE', '/sd', sd, '/st', taskTime, '/rl', 'LIMITED', '/f'], { stdio: 'pipe', timeout: 15000 });
  } else if (process.platform === 'darwin') {
    const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const label = `com.claude-shift.${taskId}`;
    const plistFile = path.join(plistDir, `${label}.plist`);
    const [hours, minutes] = taskTime.split(':').map(Number);
    const [, month, day] = date.split('-').map(Number);

    fs.mkdirSync(plistDir, { recursive: true });
    try { execFileSync('launchctl', ['unload', plistFile], { stdio: 'pipe' }); } catch {}

    const cmdArgs = parseCommandArgs(command);
    const argsXml = cmdArgs.map(a => `      <string>${escapeXml(a)}</string>`).join('\n');
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Month</key>
      <integer>${month}</integer>
      <key>Day</key>
      <integer>${day}</integer>
      <key>Hour</key>
      <integer>${hours}</integer>
      <key>Minute</key>
      <integer>${minutes}</integer>
    </dict>
  </array>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(os.homedir(), '.claude-shift', 'launchd-stdout.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(os.homedir(), '.claude-shift', 'launchd-stderr.log'))}</string>
</dict>
</plist>`;
    fs.writeFileSync(plistFile, plist, 'utf-8');
    execFileSync('launchctl', ['load', plistFile], { stdio: 'pipe' });
  } else {
    const [hours, minutes] = taskTime.split(':');
    const [, mo, dy] = date.split('-');
    const tag = `# claude-shift:${taskId}`;
    const entry = `${parseInt(minutes)} ${parseInt(hours)} ${parseInt(dy)} ${parseInt(mo)} * ${command} ${tag}`;
    let crontab = '';
    try { crontab = execFileSync('crontab', ['-l'], { encoding: 'utf-8', timeout: 5000 }).toString(); } catch {}
    crontab = crontab.split('\n').filter(l => !l.includes(tag)).join('\n');
    crontab = crontab.trimEnd() + '\n' + entry + '\n';
    execFileSync('crontab', ['-'], { input: crontab, encoding: 'utf-8', timeout: 5000 });
  }
}

function scheduleRetryTask(triggerId, retryTime, nextRetryIndex, originalTime, config) {
  const nodePath = config?.settings?.nodePath || process.execPath;
  const scriptPath = fileURLToPath(import.meta.url);
  const command = `"${nodePath}" "${scriptPath}" "${triggerId}" --retry ${nextRetryIndex} --original-time ${originalTime}`;
  scheduleOsTask(`retry-${triggerId}`, retryTime, command);
}

// --- Limit detection ---

const MONTH_NAMES = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function detectLimitHit(response) {
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

function parseResetTime(response) {
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

function formatDateStr(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const LIMIT_RETRY_BUFFER_MINUTES = 3;

function handleLimitRetry(triggerId, limitType, resetTime, isLimitRetry) {
  if (isLimitRetry) {
    log(`RETRY trigger=${triggerId} status=exhausted detail="limit-retry failed again (${limitType})"`);
    return;
  }

  if (!limitType || limitType === 'monthly') {
    log(`RETRY trigger=${triggerId} status=skip detail="monthly limit hit — manual action required (/usage-credits)"`);
    return;
  }

  if (!resetTime) {
    log(`RETRY trigger=${triggerId} status=skip detail="${limitType} limit hit but reset time not parseable from response"`);
    return;
  }

  const now = new Date();
  if (resetTime.getTime() <= now.getTime()) {
    log(`RETRY trigger=${triggerId} status=skip detail="${limitType} limit — reset time already passed (${formatLocalTime(resetTime)})"`);
    return;
  }

  const config = loadConfig();
  const trigger = config?.triggers?.find(t => t.id === triggerId);

  if (trigger?.smartMeta?.targetSlotEnd) {
    const slotEndMinutes = timeToMinutes(trigger.smartMeta.targetSlotEnd);
    const resetMinutes = resetTime.getHours() * 60 + resetTime.getMinutes();
    const resetDateStr = formatDateStr(resetTime);
    const today = todayDateStr();
    if (resetDateStr !== today || resetMinutes >= slotEndMinutes) {
      log(`RETRY trigger=${triggerId} status=skip detail="${limitType} limit — reset at ${formatLocalTime(resetTime)} is outside shift window (ends ${trigger.smartMeta.targetSlotEnd})"`);
      return;
    }
  } else {
    const resetDateStr = formatDateStr(resetTime);
    if (resetDateStr !== todayDateStr()) {
      log(`RETRY trigger=${triggerId} status=skip detail="${limitType} limit — reset is on a future date (${formatLocalTime(resetTime)})"`);
      return;
    }
  }

  const retryDate = new Date(resetTime.getTime() + LIMIT_RETRY_BUFFER_MINUTES * 60 * 1000);
  const retryHH = String(retryDate.getHours()).padStart(2, '0');
  const retryMM = String(retryDate.getMinutes()).padStart(2, '0');
  const retryTime = `${retryHH}:${retryMM}`;

  if (timeToMinutes(retryTime) >= 24 * 60 - 1) {
    log(`RETRY trigger=${triggerId} status=skip detail="${limitType} limit — retry time ${retryTime} would cross midnight"`);
    return;
  }

  const nodePath = config?.settings?.nodePath || process.execPath;
  const scriptPath = fileURLToPath(import.meta.url);
  const command = `"${nodePath}" "${scriptPath}" "${triggerId}" --limit-retry`;
  scheduleOsTask(`limit-retry-${triggerId}`, retryTime, command);
  log(`RETRY trigger=${triggerId} status=scheduled detail="${limitType} limit — retry at ${retryTime} (resets ${formatLocalTime(resetTime)})"`);
}

function handleRetry(triggerId, isRetry, retryIndex, originalTime) {
  try {
    const config = loadConfig();

    const retryEnabled = config?.settings?.retryEnabled !== false;
    if (!retryEnabled) {
      log(`RETRY trigger=${triggerId} status=disabled detail="retries are disabled in settings"`);
      return;
    }

    const intervals = Array.isArray(config?.settings?.retryIntervals) && config.settings.retryIntervals.length > 0
      ? config.settings.retryIntervals
      : [5, 15, 30, 45, 60];

    if (!originalTime) {
      const trigger = config?.triggers?.find(t => t.id === triggerId);
      if (trigger) {
        originalTime = trigger.time;
      } else {
        log(`RETRY trigger=${triggerId} status=error detail="trigger not found in config, cannot schedule retry"`);
        return;
      }
    }

    const nextIndex = isRetry ? retryIndex + 1 : 0;

    if (nextIndex >= intervals.length) {
      log(`RETRY trigger=${triggerId} status=exhausted detail="all ${intervals.length} retry attempts used"`);
      return;
    }

    const retryMinutes = timeToMinutes(originalTime) + intervals[nextIndex];
    if (retryMinutes >= 24 * 60) {
      log(`RETRY trigger=${triggerId} status=skip detail="retry time would cross midnight"`);
      return;
    }
    const retryTime = minutesToTime(retryMinutes);

    const conflict = findConflictingTrigger(config, triggerId, originalTime, retryTime);
    if (conflict) {
      log(`RETRY trigger=${triggerId} status=cancelled detail="existing trigger ${conflict.id} at ${conflict.time} before retry time ${retryTime}"`);
      return;
    }

    scheduleRetryTask(triggerId, retryTime, nextIndex, originalTime, config);
    log(`RETRY trigger=${triggerId} status=scheduled detail="attempt ${nextIndex + 1}/${intervals.length} at ${retryTime} (original=${originalTime})"`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`RETRY trigger=${triggerId} status=error detail="failed to schedule: ${sanitizeLog(errMsg)}"`);
  }
}

async function main() {
  const nodeBinDir = path.dirname(process.execPath);
  if (process.env.PATH && !process.env.PATH.split(path.delimiter).includes(nodeBinDir)) {
    process.env.PATH = nodeBinDir + path.delimiter + process.env.PATH;
  } else if (!process.env.PATH) {
    process.env.PATH = nodeBinDir;
  }

  const triggerId = process.argv[2] || 'scheduled';

  const retryArgIdx = process.argv.indexOf('--retry');
  const isRetry = retryArgIdx !== -1;
  const retryIndex = isRetry ? parseInt(process.argv[retryArgIdx + 1], 10) : -1;
  const origTimeIdx = process.argv.indexOf('--original-time');
  const originalTime = origTimeIdx !== -1 ? process.argv[origTimeIdx + 1] : null;
  const isLimitRetry = process.argv.includes('--limit-retry');

  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });
  process.on('SIGINT', () => { releaseLock(); process.exit(0); });

  const lockStatus = acquireLock();
  if (lockStatus === 'held') {
    if (isRetry) {
      log(`RETRY trigger=${triggerId} status=skip detail="lock held, another ping running (attempt ${retryIndex + 1})"`);
    } else {
      log('SKIP another ping is running (lock held)');
    }
    process.exit(0);
  }
  if (lockStatus === 'failed') {
    log(`ERROR trigger=${triggerId} could not acquire lock`);
    process.exit(1);
  }

  const retryLabel = isRetry ? ` retry=${retryIndex + 1}` : isLimitRetry ? ' limit-retry' : '';
  log(`PING trigger=${triggerId}${retryLabel} status=starting`);
  const start = Date.now();

  try {
    const pty = await import('@lydell/node-pty');
    const config = loadConfig();
    const claudePath = loadClaudePath(config);
    const message = loadPingMessage(config);
    const pingCwd = loadPingPath(config);

    if (!claudePath || SHELL_META.test(claudePath)) {
      throw new Error(`Invalid claudePath: "${claudePath}"`);
    }

    if (!path.isAbsolute(claudePath) && !fs.existsSync(claudePath)) {
      log(`PING trigger=${triggerId} status=warn detail="Claude not found via PATH or common locations. Fix with: claude-shift config set claudePath /absolute/path/to/claude"`);
    }

    let done = false;
    const isWinScript = process.platform === 'win32' &&
      /\.(cmd|bat)$/i.test(claudePath);
    const spawnFile = isWinScript ? 'cmd.exe' : claudePath;
    const spawnArgs = isWinScript ? ['/c', claudePath] : [];

    const proc = pty.spawn(spawnFile, spawnArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: pingCwd,
    });

    let output = '';
    let responseOutput = '';
    let sentMessage = false;
    let trustSeen = false;
    let readyTimer = null;

    function stripAnsi(s) {
      return s.replace(ANSI_RE, '');
    }

    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill(); } catch {}
      const duration = Date.now() - start;
      const resp = responseOutput ? extractResponse(responseOutput, message) : '';
      const respPart = resp ? ` response="${sanitizeLog(resp)}"` : '';
      const limit = detectLimitHit(resp);
      if (limit) {
        const resetTime = limit.retryable ? parseResetTime(resp) : null;
        const resetDetail = resetTime ? ` resets=${formatLocalTime(resetTime)}` : '';
        log(`PING trigger=${triggerId}${retryLabel} status=limit-${limit.type} detail="timeout after ${duration}ms${resetDetail}"${respPart}`);
        handleLimitRetry(triggerId, limit.type, resetTime, isLimitRetry);
        releaseLock();
        process.exit(1);
        return;
      }
      log(`PING trigger=${triggerId}${retryLabel} status=success detail="timeout after ${duration}ms — session was started"${respPart}`);
      disableOnceTrigger(triggerId);
      releaseLock();
      process.exit(0);
    }, 60000);

    function scheduleMessage(delayMs) {
      if (readyTimer || sentMessage || done) return;
      readyTimer = setTimeout(() => {
        if (done || sentMessage) return;
        sentMessage = true;
        responseOutput = '';
        proc.write(message + '\r');
        setTimeout(() => {
          if (done) return;
          proc.write('/exit\r');
        }, 12000);
      }, delayMs);
    }

    proc.onData((data) => {
      if (output.length > 1_000_000) return;
      output += data;
      if (sentMessage) responseOutput += data;
      const clean = stripAnsi(output);

      if (!trustSeen && TRUST_RE.test(clean)) {
        trustSeen = true;
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
        setTimeout(() => {
          if (done) return;
          proc.write('\r');
          scheduleMessage(5000);
        }, 500);
        return;
      }

      if (!trustSeen && !sentMessage && clean.length > 200) {
        scheduleMessage(5000);
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

      if (ok) {
        const limit = detectLimitHit(resp);
        if (limit) {
          const resetTime = limit.retryable ? parseResetTime(resp) : null;
          const resetDetail = resetTime ? ` resets=${formatLocalTime(resetTime)}` : '';
          log(`PING trigger=${triggerId}${retryLabel} status=limit-${limit.type} detail="exit=${exitCode} duration=${duration}ms${resetDetail}"${respPart}`);
          handleLimitRetry(triggerId, limit.type, resetTime, isLimitRetry);
          releaseLock();
          process.exit(1);
          return;
        }
        log(`PING trigger=${triggerId}${retryLabel} status=success detail="exit=${exitCode} duration=${duration}ms"${respPart}`);
        disableOnceTrigger(triggerId);
      } else {
        log(`PING trigger=${triggerId}${retryLabel} status=error detail="exit=${exitCode} duration=${duration}ms"${respPart}`);
        handleRetry(triggerId, isRetry, retryIndex, originalTime);
      }
      releaseLock();
      process.exit(ok ? 0 : 1);
    });
  } catch (err) {
    const duration = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`PING trigger=${triggerId}${retryLabel} status=error detail="${sanitizeLog(errMsg)}" duration=${duration}ms`);
    handleRetry(triggerId, isRetry, retryIndex, originalTime);
    releaseLock();
    process.exit(1);
  }
}

main();
