import { describe, expect, it } from 'vitest';
import { buildTaskXml, EXECUTION_TIME_LIMIT, firstRunDate, splitCommand } from '../src/scheduler/schtasks-xml.js';
import type { ScheduledTask } from '../src/scheduler/types.js';

const NODE_COMMAND = '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\a b\\scripts\\ping-runner.js" "062" --retry 1 --original-time 05:00';
const WEEKLY: ScheduledTask = { id: '062', command: NODE_COMMAND, time: '05:00', days: ['mon', 'fri'] };
const ONCE: ScheduledTask = { id: 'retry-062-0', command: NODE_COMMAND, time: '14:30', days: [], date: '2026-11-11' };
const MORNING = new Date(2026, 10, 10, 4, 0);
const AFTERNOON = new Date(2026, 10, 10, 15, 0);

describe('splitCommand', () => {
  it('separates a quoted program path from its arguments', () => {
    expect(splitCommand(NODE_COMMAND)).toEqual({
      program: 'C:\\Program Files\\nodejs\\node.exe',
      args: '"C:\\Users\\a b\\scripts\\ping-runner.js" "062" --retry 1 --original-time 05:00',
    });
  });

  it('handles an unquoted program and a command with no arguments', () => {
    expect(splitCommand('node run.js 1')).toEqual({ program: 'node', args: 'run.js 1' });
    expect(splitCommand('node')).toEqual({ program: 'node', args: '' });
  });

  it('rejects an unterminated quote instead of registering a broken task', () => {
    expect(() => splitCommand('"C:\\node.exe arg')).toThrow(/Unterminated quote/);
  });
});

describe('firstRunDate', () => {
  it('starts today when the time is still ahead', () => {
    expect(firstRunDate('05:00', MORNING)).toBe('2026-11-10');
  });

  it('starts tomorrow when today\'s time has passed, so registering never triggers a catch-up run', () => {
    expect(firstRunDate('05:00', AFTERNOON)).toBe('2026-11-11');
    expect(firstRunDate('15:00', AFTERNOON)).toBe('2026-11-11');
  });

  it('rolls over a month end', () => {
    expect(firstRunDate('05:00', new Date(2026, 10, 30, 12, 0))).toBe('2026-12-01');
  });
});

describe('buildTaskXml', () => {
  const xml = buildTaskXml(WEEKLY, AFTERNOON);

  it('lets a laptop on battery run the ping and never stops it for going on battery', () => {
    expect(xml).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>');
    expect(xml).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>');
  });

  it('runs a start that was missed as soon as the PC is available', () => {
    expect(xml).toContain('<StartWhenAvailable>true</StartWhenAvailable>');
  });

  it('bounds a hung run and ignores a second start while one is running', () => {
    expect(EXECUTION_TIME_LIMIT).toBe('PT7M');
    expect(xml).toContain(`<ExecutionTimeLimit>${EXECUTION_TIME_LIMIT}</ExecutionTimeLimit>`);
    expect(xml).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>');
  });

  it('does not wake the PC and runs only for the logged-on user, locked or not', () => {
    expect(xml).not.toContain('WakeToRun');
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>');
    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>');
  });

  it('builds a weekly trigger with the chosen days and an ISO start', () => {
    expect(xml).toContain('<CalendarTrigger><StartBoundary>2026-11-11T05:00:00</StartBoundary>');
    expect(xml).toContain('<DaysOfWeek><Monday /><Friday /></DaysOfWeek>');
    expect(xml).toContain('<WeeksInterval>1</WeeksInterval>');
  });

  it('builds a one-time trigger on the pinned date', () => {
    const once = buildTaskXml(ONCE, AFTERNOON);
    expect(once).toContain('<TimeTrigger><StartBoundary>2026-11-11T14:30:00</StartBoundary>');
    expect(once).not.toContain('CalendarTrigger');
  });

  it('puts the program and the arguments in separate, escaped elements', () => {
    expect(xml).toContain('<Command>C:\\Program Files\\nodejs\\node.exe</Command>');
    expect(xml).toContain('<Arguments>&quot;C:\\Users\\a b\\scripts\\ping-runner.js&quot; &quot;062&quot; --retry 1 --original-time 05:00</Arguments>');
  });

  it('escapes markup characters in paths', () => {
    const tricky = buildTaskXml({ ...WEEKLY, command: '"C:\\R&D <x>\\node.exe" "a\'b"' }, AFTERNOON);
    expect(tricky).toContain('<Command>C:\\R&amp;D &lt;x&gt;\\node.exe</Command>');
    expect(tricky).toContain('<Arguments>&quot;a&apos;b&quot;</Arguments>');
  });

  it('omits the arguments element when there are none', () => {
    expect(buildTaskXml({ ...WEEKLY, command: '"C:\\node.exe"' }, AFTERNOON)).not.toContain('<Arguments>');
  });

  it('refuses a repeating task with no days', () => {
    expect(() => buildTaskXml({ ...WEEKLY, days: [] }, AFTERNOON)).toThrow(/no days/);
  });
});
