import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Windows scheduler is driven through `schtasks`; mock the process layer so its failure
// handling can be tested on any platform.
const execFileSync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync }));

import { SchtasksScheduler } from '../src/scheduler/schtasks.js';

const QUERY_OUTPUT = [
  '"\\Microsoft\\Windows\\Other\\Task","N/A","Ready"',
  '"\\claude-shift-001","11/10/2026 12:00:00 PM","Ready"',
  '"\\claude-shift-retry-001-0","N/A","Ready"',
  '"\\SomeoneElse","N/A","Ready"',
].join('\r\n');

const isQuery = (args: string[]): boolean => args[0] === '/query';
const isDelete = (args: string[]): boolean => args[0] === '/delete';
const deleted = (): string[] => execFileSync.mock.calls.filter(([, a]) => isDelete(a)).map(([, a]) => a[2]);

describe('SchtasksScheduler.removeAll', () => {
  beforeEach(() => { execFileSync.mockReset(); });

  it('deletes only this instance\'s tasks', async () => {
    execFileSync.mockImplementation((_cmd: string, args: string[]) => (isQuery(args) ? QUERY_OUTPUT : ''));
    await new SchtasksScheduler().removeAll();
    expect(deleted()).toEqual(['claude-shift-001', 'claude-shift-retry-001-0']);
  });

  it('fails instead of reporting success when the task list cannot be read', async () => {
    execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (isQuery(args)) throw new Error('spawnSync schtasks ETIMEDOUT');
      return '';
    });
    await expect(new SchtasksScheduler().removeAll()).rejects.toThrow(/ETIMEDOUT/);
  });

  it('fails, naming the task, when a task cannot be deleted — after trying the others', async () => {
    execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (isQuery(args)) return QUERY_OUTPUT;
      if (isDelete(args) && args[2] === 'claude-shift-001') throw new Error('ERROR: Access is denied.');
      return '';
    });
    await expect(new SchtasksScheduler().removeAll()).rejects.toThrow(/claude-shift-001/);
    expect(deleted()).toEqual(['claude-shift-001', 'claude-shift-retry-001-0']);
  });

  it('gives the task list query enough time on a machine with many tasks', async () => {
    execFileSync.mockImplementation((_cmd: string, args: string[]) => (isQuery(args) ? QUERY_OUTPUT : ''));
    await new SchtasksScheduler().removeAll();
    const queryCall = execFileSync.mock.calls.find(([, a]) => isQuery(a));
    expect(queryCall?.[2].timeout).toBeGreaterThanOrEqual(60_000);
  });
});

describe('SchtasksScheduler.remove', () => {
  beforeEach(() => { execFileSync.mockReset(); });

  it('stays quiet when the task does not exist', async () => {
    execFileSync.mockImplementation(() => { throw new Error('ERROR: The system cannot find the file specified.'); });
    await expect(new SchtasksScheduler().remove('001')).resolves.toBeUndefined();
  });
});
