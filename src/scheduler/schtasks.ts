import { execFileSync } from 'node:child_process';
import type { DayOfWeek } from '../config/schema.js';
import type { SchedulerBackend, ScheduledTask, InstalledTask, SchedulerCheckResult } from './types.js';
import { toErrorMessage } from '../utils/text.js';
import { schtasksPrefix } from '../config/namespace.js';

const TASK_PREFIX = schtasksPrefix();

const SCHTASKS_DAY_MAP: Record<DayOfWeek, string> = {
  mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI', sat: 'SAT', sun: 'SUN',
};

function taskName(id: string): string {
  return `${TASK_PREFIX}${id}`;
}

function schtasks(...args: string[]): string {
  return execFileSync('schtasks', args, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
}

export type DateOrder = 'MDY' | 'DMY' | 'YMD';
const DEFAULT_DATE_ORDER: DateOrder = 'MDY';
const DATE_ORDERS: readonly string[] = ['MDY', 'DMY', 'YMD'];
const INTERNATIONAL_KEY = 'HKCU\\Control Panel\\International';

/** Day/month/year order of a Windows short-date pattern such as "dd-MM-yyyy" or "M/d/yyyy". */
export function dateOrderFromPattern(pattern: string): DateOrder | null {
  const order = [...new Set((pattern.match(/d+|M+|y+/g) ?? []).map((t) => t[0].toUpperCase()))].join('');
  return DATE_ORDERS.includes(order) ? order as DateOrder : null;
}

let cachedDateOrder: DateOrder | undefined;

// schtasks /sd only accepts the user's regional day/month order (always "/"-separated), so a
// hardcoded mm/dd/yyyy fails with "Incorrect Start Date" on dd/mm locales.
function regionalDateOrder(): DateOrder {
  if (cachedDateOrder) return cachedDateOrder;
  try {
    const out = execFileSync('reg', ['query', INTERNATIONAL_KEY, '/v', 'sShortDate'], { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    cachedDateOrder = dateOrderFromPattern(out.match(/sShortDate\s+REG_SZ\s+(.+)/)?.[1]?.trim() ?? '') ?? DEFAULT_DATE_ORDER;
  } catch {
    cachedDateOrder = DEFAULT_DATE_ORDER;
  }
  return cachedDateOrder;
}

/** Formats a YYYY-MM-DD date for `schtasks /sd`. */
export function toSchtasksDate(isoDate: string, order: DateOrder = regionalDateOrder()): string {
  const [y, m, d] = isoDate.split('-');
  const parts: Record<string, string> = { Y: y, M: m, D: d };
  return [...order].map((k) => parts[k]).join('/');
}

export class SchtasksScheduler implements SchedulerBackend {
  readonly name = 'schtasks';

  async install(task: ScheduledTask): Promise<void> {
    const name = taskName(task.id);

    try { schtasks('/delete', '/tn', name, '/f'); } catch {}

    if (task.date) {
      schtasks('/create', '/tn', name, '/tr', task.command, '/sc', 'ONCE', '/sd', toSchtasksDate(task.date), '/st', task.time, '/rl', 'LIMITED', '/f');
    } else {
      const days = task.days.map(d => SCHTASKS_DAY_MAP[d]).join(',');
      schtasks('/create', '/tn', name, '/tr', task.command, '/sc', 'WEEKLY', '/d', days, '/st', task.time, '/rl', 'LIMITED', '/f');
    }
  }

  async remove(id: string): Promise<void> {
    const name = taskName(id);
    try { schtasks('/delete', '/tn', name, '/f'); } catch {}
  }

  async removeAll(): Promise<void> {
    try {
      const output = schtasks('/query', '/fo', 'CSV', '/nh');
      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const cols = trimmed.split('","').map(s => s.replace(/"/g, ''));
        if (cols.length < 1 || !cols[0]) continue;
        const name = cols[0].replace(/^\\+/, '');
        if (!name.startsWith(TASK_PREFIX)) continue;
        const id = name.slice(TASK_PREFIX.length);
        await this.remove(id);
      }
    } catch {
      // No tasks found or query failed — nothing to remove
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
        const statusText = (cols[2] ?? '').toLowerCase();
        const isDisabled = statusText.includes('disabled') || statusText.includes('disable');
        const status = isDisabled ? 'inactive' as const : 'active' as const;
        results.push({ id, time: cols[1] ?? '', days: '', status });
      }

      return results;
    } catch {
      return [];
    }
  }

  async check(): Promise<SchedulerCheckResult> {
    try {
      schtasks('/query', '/fo', 'CSV', '/nh');
      return { available: true };
    } catch (err) {
      const msg = toErrorMessage(err);
      if (msg.includes('Access is denied')) {
        return { available: false, reason: 'Access denied. Try running as administrator.' };
      }
      return { available: false, reason: msg || 'schtasks command failed' };
    }
  }
}
