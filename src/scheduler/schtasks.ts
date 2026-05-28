import { execFileSync } from 'node:child_process';
import type { DayOfWeek } from '../config/schema.js';
import type { SchedulerBackend, ScheduledTask, InstalledTask, SchedulerCheckResult } from './types.js';

const TASK_PREFIX = 'claude-shift-';

const SCHTASKS_DAY_MAP: Record<DayOfWeek, string> = {
  mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI', sat: 'SAT', sun: 'SUN',
};

function taskName(id: string): string {
  return `${TASK_PREFIX}${id}`;
}

function schtasks(...args: string[]): string {
  return execFileSync('schtasks', args, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
}

export class SchtasksScheduler implements SchedulerBackend {
  readonly name = 'schtasks';

  async install(task: ScheduledTask): Promise<void> {
    const name = taskName(task.id);
    const days = task.days.map(d => SCHTASKS_DAY_MAP[d]).join(',');

    try { schtasks('/delete', '/tn', name, '/f'); } catch {}

    schtasks('/create', '/tn', name, '/tr', task.command, '/sc', 'WEEKLY', '/d', days, '/st', task.time, '/rl', 'LIMITED', '/f');
  }

  async remove(id: string): Promise<void> {
    const name = taskName(id);
    try { schtasks('/delete', '/tn', name, '/f'); } catch {}
  }

  async removeAll(): Promise<void> {
    const tasks = await this.list();
    for (const task of tasks) {
      await this.remove(task.id);
    }
  }

  async list(): Promise<InstalledTask[]> {
    try {
      const output = schtasks('/query', '/fo', 'CSV', '/nh');
      const results: InstalledTask[] = [];

      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const cols = trimmed.split('","').map(s => s.replace(/"/g, ''));
        if (cols.length < 3 || !cols[0]) continue;
        const name = cols[0].replace(/^\\+/, '');
        if (!name.startsWith(TASK_PREFIX)) continue;

        const id = name.slice(TASK_PREFIX.length);
        const status = cols[2]?.toLowerCase().includes('ready') ? 'active' as const : 'inactive' as const;
        results.push({ id, time: cols[1] ?? '', days: '', status });
      }

      return results;
    } catch {
      return [];
    }
  }

  async check(): Promise<SchedulerCheckResult> {
    try {
      schtasks('/query', '/fo', 'LIST', '/tn', '\\Microsoft');
      return { available: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Access is denied')) {
        return { available: false, reason: 'Access denied. Try running as administrator.' };
      }
      return { available: true };
    }
  }
}
