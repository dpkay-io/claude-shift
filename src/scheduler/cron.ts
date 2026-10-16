import { execSync } from 'node:child_process';
import type { DayOfWeek } from '../config/schema.js';
import type { SchedulerBackend, ScheduledTask, InstalledTask, SchedulerCheckResult } from './types.js';
import { cronTagPrefix } from '../config/namespace.js';

const CRON_DAY_MAP: Record<DayOfWeek, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function toCronDays(days: DayOfWeek[]): string {
  return days.map(d => CRON_DAY_MAP[d]).join(',');
}

function getCurrentCrontab(): string {
  try {
    return execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' });
  } catch {
    return '';
  }
}

// Exact match on the trailing tag, so removing "retry-001-1" leaves "retry-001-10" alone.
function isTaskLine(line: string, id: string): boolean {
  return line.trimEnd().endsWith(`${cronTagPrefix()}${id}`);
}

function writeCrontab(content: string): void {
  execSync('crontab -', { input: content, encoding: 'utf-8' });
}

export class CronScheduler implements SchedulerBackend {
  readonly name = 'cron';

  async install(task: ScheduledTask): Promise<void> {
    if (/[\n\r]/.test(task.command)) throw new Error('Command must not contain newlines');
    const timeParts = task.time.split(':');
    if (timeParts.length < 2) throw new Error(`Invalid time format: "${task.time}" (expected HH:mm)`);
    const [hours, minutes] = timeParts;

    let entry: string;
    if (task.date) {
      const [, m, d] = task.date.split('-');
      entry = `${parseInt(minutes!, 10)} ${parseInt(hours!, 10)} ${parseInt(d!, 10)} ${parseInt(m!, 10)} * ${task.command} ${cronTagPrefix()}${task.id}`;
    } else {
      const cronDays = toCronDays(task.days);
      entry = `${parseInt(minutes!, 10)} ${parseInt(hours!, 10)} * * ${cronDays} ${task.command} ${cronTagPrefix()}${task.id}`;
    }

    let crontab = getCurrentCrontab();
    crontab = crontab.split('\n').filter(l => !isTaskLine(l, task.id)).join('\n');
    crontab = crontab.trimEnd() + '\n' + entry + '\n';
    writeCrontab(crontab);
  }

  async remove(id: string): Promise<void> {
    let crontab = getCurrentCrontab();
    const lines = crontab.split('\n').filter(l => !isTaskLine(l, id));
    writeCrontab(lines.join('\n'));
  }

  async removeAll(): Promise<void> {
    let crontab = getCurrentCrontab();
    const lines = crontab.split('\n').filter(l => !l.includes(cronTagPrefix()));
    writeCrontab(lines.join('\n'));
  }

  async list(): Promise<InstalledTask[]> {
    const crontab = getCurrentCrontab();
    const results: InstalledTask[] = [];

    for (const line of crontab.split('\n')) {
      const tagIdx = line.indexOf(cronTagPrefix());
      if (tagIdx === -1) continue;

      const id = line.slice(tagIdx + cronTagPrefix().length).trim();
      const parts = line.trim().split(/\s+/);
      const time = `${parts[1]?.padStart(2, '0') ?? '00'}:${parts[0]?.padStart(2, '0') ?? '00'}`;
      const days = parts[4] ?? '';

      results.push({ id, time, days, status: 'active' });
    }

    return results;
  }

  async check(): Promise<SchedulerCheckResult> {
    try {
      execSync('which crontab', { encoding: 'utf-8', timeout: 5000 });
      return { available: true };
    } catch {
      return { available: false, reason: 'crontab command not found' };
    }
  }
}
