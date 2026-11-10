import type { DayOfWeek } from '../config/schema.js';
import type { ScheduledTask } from './types.js';
import { PING_TIMEOUT_MS } from '../core/ping.js';

// `schtasks /create` has no switches for power or catch-up behaviour, so tasks are registered from an
// XML definition (`schtasks /create /xml`). The XML also takes ISO dates, which removes the need to
// guess the machine's regional date order.

const TASK_NAMESPACE = 'http://schemas.microsoft.com/windows/2004/02/mit/task';
const TASK_SCHEMA_VERSION = '1.2';
export const TASK_XML_ENCODING = 'UTF-16';

const WINDOWS_DAY_NAMES: Record<DayOfWeek, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

// A ping runs claude once and, when that fails without a response, once more with plain arguments;
// the runner may then schedule a retry. Anything past that is a hung run, and Windows' default
// limit of 72 hours would let it block every later run (MultipleInstancesPolicy IgnoreNew).
const MAX_PING_ATTEMPTS = 2;
const RUN_OVERHEAD_MS = 3 * 60_000;
const MS_PER_MINUTE = 60_000;
export const EXECUTION_TIME_LIMIT = `PT${Math.ceil((MAX_PING_ATTEMPTS * PING_TIMEOUT_MS + RUN_OVERHEAD_MS) / MS_PER_MINUTE)}M`;

const SETTINGS: ReadonlyArray<readonly [string, string]> = [
  ['MultipleInstancesPolicy', 'IgnoreNew'],
  // A laptop on battery must still ping; a ping costs a few seconds of CPU and one small request.
  ['DisallowStartIfOnBatteries', 'false'],
  ['StopIfGoingOnBatteries', 'false'],
  ['AllowHardTerminate', 'true'],
  // A start missed because the PC was asleep, locked out or busy runs as soon as the PC is available.
  ['StartWhenAvailable', 'true'],
  ['RunOnlyIfNetworkAvailable', 'false'],
  ['AllowStartOnDemand', 'true'],
  ['Enabled', 'true'],
  ['Hidden', 'false'],
  ['ExecutionTimeLimit', EXECUTION_TIME_LIMIT],
  ['Priority', '7'],
];

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Splits `"C:\path to\node.exe" "script.js" arg` into the program and its argument string. */
export function splitCommand(command: string): { program: string; args: string } {
  const text = command.trim();
  if (text.startsWith('"')) {
    const close = text.indexOf('"', 1);
    if (close === -1) throw new Error(`Unterminated quote in task command: ${command}`);
    return { program: text.slice(1, close), args: text.slice(close + 1).trim() };
  }
  const space = text.search(/\s/);
  return space === -1 ? { program: text, args: '' } : { program: text.slice(0, space), args: text.slice(space + 1).trim() };
}

const pad = (n: number): string => String(n).padStart(2, '0');

function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * First day a repeating trigger may fire. A start time that has already passed today begins
 * tomorrow, so registering a task never makes Windows run "today's missed start" on the spot.
 */
export function firstRunDate(time: string, now: Date = new Date()): string {
  const [hours, minutes] = time.split(':').map(Number);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
  if (todayStart.getTime() > now.getTime()) return localDate(now);
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

function triggerXml(task: ScheduledTask, now: Date): string {
  const startBoundary = `${task.date ?? firstRunDate(task.time, now)}T${task.time}:00`;
  const common = `<StartBoundary>${startBoundary}</StartBoundary><Enabled>true</Enabled>`;
  if (task.date) return `<TimeTrigger>${common}</TimeTrigger>`;
  if (task.days.length === 0) throw new Error(`Task ${task.id} has no days to run on`);
  const days = task.days.map((d) => `<${WINDOWS_DAY_NAMES[d]} />`).join('');
  return `<CalendarTrigger>${common}<ScheduleByWeek><DaysOfWeek>${days}</DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek></CalendarTrigger>`;
}

export function buildTaskXml(task: ScheduledTask, now: Date = new Date()): string {
  const { program, args } = splitCommand(task.command);
  const settings = SETTINGS.map(([name, value]) => `<${name}>${value}</${name}>`).join('');
  const argumentsXml = args ? `<Arguments>${escapeXml(args)}</Arguments>` : '';
  return [
    `<?xml version="1.0" encoding="${TASK_XML_ENCODING}"?>`,
    `<Task version="${TASK_SCHEMA_VERSION}" xmlns="${TASK_NAMESPACE}">`,
    `<RegistrationInfo><Description>claude-shift scheduled ping</Description></RegistrationInfo>`,
    `<Triggers>${triggerXml(task, now)}</Triggers>`,
    // Runs as the person who registered it, while they are logged on (a locked screen still counts).
    `<Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`,
    `<Settings>${settings}</Settings>`,
    `<Actions Context="Author"><Exec><Command>${escapeXml(program)}</Command>${argumentsXml}</Exec></Actions>`,
    `</Task>`,
  ].join('\n');
}
