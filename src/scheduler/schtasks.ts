import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SchedulerBackend, ScheduledTask, InstalledTask, SchedulerCheckResult } from './types.js';
import { toErrorMessage } from '../utils/text.js';
import { schtasksPrefix } from '../config/namespace.js';
import { buildTaskXml } from './schtasks-xml.js';

function taskName(id: string): string {
  return `${schtasksPrefix()}${id}`;
}

const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const SCHTASKS_TIMEOUT_MS = 15_000;
// Listing walks every task on the machine, which took about 12s on a real Windows box, so it gets
// far more room than a single create/delete. A listing that times out must not read as "no tasks".
const SCHTASKS_QUERY_TIMEOUT_MS = 60_000;

function schtasks(...args: string[]): string {
  const timeout = args[0] === '/query' ? SCHTASKS_QUERY_TIMEOUT_MS : SCHTASKS_TIMEOUT_MS;
  return execFileSync('schtasks', args, { encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] });
}

export class SchtasksScheduler implements SchedulerBackend {
  readonly name = 'schtasks';

  async install(task: ScheduledTask): Promise<void> {
    const name = taskName(task.id);

    try { schtasks('/delete', '/tn', name, '/f'); } catch {}

    // schtasks reads the definition as UTF-16 with a byte-order mark.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-shift-task-'));
    const file = path.join(dir, 'task.xml');
    try {
      fs.writeFileSync(file, Buffer.concat([UTF16LE_BOM, Buffer.from(buildTaskXml(task), 'utf16le')]));
      schtasks('/create', '/tn', name, '/xml', file, '/f');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async remove(id: string): Promise<void> {
    const name = taskName(id);
    try { schtasks('/delete', '/tn', name, '/f'); } catch {}
  }

  async removeAll(): Promise<void> {
    // Errors are not swallowed here: uninstall must not say "removed" for tasks that are still there.
    const output = schtasks('/query', '/fo', 'CSV', '/nh');
    const failed: string[] = [];
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const cols = trimmed.split('","').map(s => s.replace(/"/g, ''));
      if (cols.length < 1 || !cols[0]) continue;
      const name = cols[0].replace(/^\\+/, '');
      if (!name.startsWith(schtasksPrefix())) continue;
      try {
        schtasks('/delete', '/tn', name, '/f');
      } catch (err) {
        failed.push(`${name} (${toErrorMessage(err).trim()})`);
      }
    }
    if (failed.length > 0) throw new Error(`Could not remove: ${failed.join('; ')}`);
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
        if (!name.startsWith(schtasksPrefix())) continue;

        const id = name.slice(schtasksPrefix().length);
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
