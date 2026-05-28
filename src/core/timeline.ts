import chalk from 'chalk';
import type { Trigger, WorkWindow, SmartConfig, DayOfWeek } from '../config/schema.js';
import { parseTime, dayShort } from './time-utils.js';

const COLS = 72;
const CHARS_PER_HOUR = COLS / 24;

interface SlotSpan {
  start: number;
  end: number;
  type: 'ping' | 'slot' | 'work';
}

function minuteToCol(minutes: number): number {
  return Math.round((minutes / 1440) * COLS);
}

function renderRow(spans: SlotSpan[], char: string, colorFn: (s: string) => string): string {
  const row = new Array(COLS).fill(' ');
  for (const span of spans) {
    const start = minuteToCol(span.start);
    let end = minuteToCol(span.end);
    if (end <= start) end = COLS;
    for (let i = start; i < Math.min(end, COLS); i++) {
      row[i] = char;
    }
  }
  return row.map(c => c === char ? colorFn(c) : c).join('');
}

function renderHourHeader(): string {
  let header = '';
  for (let h = 0; h < 24; h++) {
    const label = String(h).padStart(2, '0');
    header += label;
    header += ' '.repeat(Math.max(0, CHARS_PER_HOUR - 2));
  }
  return chalk.dim(header.slice(0, COLS));
}

function renderHourTicks(): string {
  let ticks = '';
  for (let h = 0; h < 24; h++) {
    ticks += '|';
    ticks += ' '.repeat(Math.max(0, CHARS_PER_HOUR - 1));
  }
  return chalk.dim(ticks.slice(0, COLS));
}

function getWindowsForDay(day: DayOfWeek, smartConfigs: SmartConfig[]): WorkWindow[] {
  const windows: WorkWindow[] = [];
  for (const sc of smartConfigs) {
    if (sc.days.includes(day)) {
      windows.push(...sc.windows);
    }
  }
  return windows;
}

export function renderDayTimeline(
  day: DayOfWeek,
  triggers: Trigger[],
  smartConfigs: SmartConfig[],
  slotDuration: number,
): string {
  const dayTriggers = triggers.filter(t => t.enabled && t.days.includes(day));
  const slotMinutes = slotDuration * 60;

  const slotSpans: SlotSpan[] = dayTriggers.map(t => {
    const start = parseTime(t.time);
    const end = (start + slotMinutes) % 1440;
    return { start, end, type: 'slot' as const };
  });

  const pingSpans: SlotSpan[] = dayTriggers.map(t => {
    const start = parseTime(t.time);
    return { start, end: Math.min(start + 1, 1440), type: 'ping' as const };
  });

  const dayWindows = getWindowsForDay(day, smartConfigs);
  const workSpans: SlotSpan[] = dayWindows.map(w => {
    const start = parseTime(w.start);
    const end = parseTime(w.end);
    return { start, end, type: 'work' as const };
  });

  const lines: string[] = [];
  const label = `  ${dayShort(day).padEnd(4)}`;

  const slotRow = renderRow(slotSpans, '─', chalk.yellow);
  const combined = slotRow.split('');
  for (const p of pingSpans) {
    const col = minuteToCol(p.start);
    if (col < COLS) combined[col] = chalk.red('⚡');
  }
  lines.push(`${label} ${combined.join('')}`);

  const workRow = renderRow(workSpans, '█', chalk.green);
  lines.push(`${''.padEnd(6)}${workRow}`);

  return lines.join('\n');
}

export function renderTimeline(
  triggers: Trigger[],
  smartConfigs: SmartConfig[],
  slotDuration: number,
  days: DayOfWeek[],
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold('  Schedule Timeline'));
  lines.push('');
  lines.push(`${''.padEnd(6)}${renderHourHeader()}`);
  lines.push(`${''.padEnd(6)}${renderHourTicks()}`);

  for (const day of days) {
    lines.push(renderDayTimeline(day, triggers, smartConfigs, slotDuration));
  }

  lines.push('');
  lines.push(chalk.dim(`  ${chalk.red('⚡')} ping  ${chalk.yellow('─')} slot (${slotDuration}h)  ${chalk.green('█')} work window`));
  lines.push('');

  return lines.join('\n');
}

export function renderToday(
  triggers: Trigger[],
  smartConfigs: SmartConfig[],
  slotDuration: number,
): string {
  const dayNames: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = dayNames[new Date().getDay()]!;
  return renderTimeline(triggers, smartConfigs, slotDuration, [today]);
}
