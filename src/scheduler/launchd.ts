import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { DayOfWeek } from '../config/schema.js';
import type { SchedulerBackend, ScheduledTask, InstalledTask, SchedulerCheckResult } from './types.js';

const PLIST_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const LABEL_PREFIX = 'com.claude-shift.';

const LAUNCHD_DAY_MAP: Record<DayOfWeek, number> = {
  sun: 1, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6, sat: 7,
};

function plistPath(id: string): string {
  return path.join(PLIST_DIR, `${LABEL_PREFIX}${id}.plist`);
}

function parseCommandArgs(cmd: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  for (const ch of cmd) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ' ' && !inQuote) {
      if (current) args.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

function buildPlist(task: ScheduledTask): string {
  const label = `${LABEL_PREFIX}${task.id}`;
  const timeParts = task.time.split(':');
  if (timeParts.length < 2) throw new Error(`Invalid time format: "${task.time}" (expected HH:mm)`);
  const [hours, minutes] = timeParts.map(Number);
  const args = parseCommandArgs(task.command).map(a => `      <string>${escapeXml(a)}</string>`).join('\n');

  let calendarEntries: string;
  if (task.date) {
    const [, m, d] = task.date.split('-').map(Number);
    calendarEntries = `      <dict>
        <key>Month</key>
        <integer>${m}</integer>
        <key>Day</key>
        <integer>${d}</integer>
        <key>Hour</key>
        <integer>${hours}</integer>
        <key>Minute</key>
        <integer>${minutes}</integer>
      </dict>`;
  } else {
    calendarEntries = task.days.map(day => `      <dict>
        <key>Hour</key>
        <integer>${hours}</integer>
        <key>Minute</key>
        <integer>${minutes}</integer>
        <key>Weekday</key>
        <integer>${LAUNCHD_DAY_MAP[day]}</integer>
      </dict>`).join('\n');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartCalendarInterval</key>
  <array>
${calendarEntries}
  </array>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(os.homedir(), '.claude-shift', 'launchd-stdout.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(os.homedir(), '.claude-shift', 'launchd-stderr.log'))}</string>
</dict>
</plist>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export class LaunchdScheduler implements SchedulerBackend {
  readonly name = 'launchd';

  async install(task: ScheduledTask): Promise<void> {
    fs.mkdirSync(PLIST_DIR, { recursive: true });
    const plist = plistPath(task.id);

    try { execFileSync('launchctl', ['unload', plist], { stdio: 'pipe' }); } catch {}

    fs.writeFileSync(plist, buildPlist(task), 'utf-8');
    execFileSync('launchctl', ['load', plist], { stdio: 'pipe' });
  }

  async remove(id: string): Promise<void> {
    const plist = plistPath(id);
    try { execFileSync('launchctl', ['unload', plist], { stdio: 'pipe' }); } catch {}
    try { fs.unlinkSync(plist); } catch {}
  }

  async removeAll(): Promise<void> {
    if (!fs.existsSync(PLIST_DIR)) return;
    const files = fs.readdirSync(PLIST_DIR).filter(f => f.startsWith(LABEL_PREFIX));
    for (const file of files) {
      const full = path.join(PLIST_DIR, file);
      try { execFileSync('launchctl', ['unload', full], { stdio: 'pipe' }); } catch {}
      try { fs.unlinkSync(full); } catch {}
    }
  }

  async list(): Promise<InstalledTask[]> {
    if (!fs.existsSync(PLIST_DIR)) return [];
    const files = fs.readdirSync(PLIST_DIR).filter(f => f.startsWith(LABEL_PREFIX));
    return files.map(f => {
      const id = f.replace(LABEL_PREFIX, '').replace('.plist', '');
      return { id, time: '', days: '', status: 'active' as const };
    });
  }

  async check(): Promise<SchedulerCheckResult> {
    try {
      execFileSync('which', ['launchctl'], { encoding: 'utf-8', timeout: 5000 });
      return { available: true };
    } catch {
      return { available: false, reason: 'launchctl not found (not macOS?)' };
    }
  }
}
