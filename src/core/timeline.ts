import chalk from 'chalk';
import type { Trigger, WorkWindow, SmartConfig, DayOfWeek } from '../config/schema.js';
import { parseTime, dayShort, todayDateString, dateToDayOfWeek, formatDateShort } from './time-utils.js';

const COLS = 72;
const CHARS_PER_HOUR = COLS / 24;
const LABEL_WIDTH = 6;

type CellType = 'empty' | 'slot' | 'work' | 'ping' | 'renewal';

function minuteToCol(minutes: number): number {
  return Math.round((minutes / 1440) * COLS);
}

function fillGrid(grid: CellType[], startMin: number, endMin: number, value: CellType): void {
  const start = minuteToCol(startMin);
  const end = minuteToCol(endMin);
  if (end === start) return;
  if (end < start) {
    for (let i = start; i < COLS; i++) grid[i] = value;
    for (let i = 0; i < end; i++) grid[i] = value;
  } else {
    for (let i = start; i < Math.min(end, COLS); i++) grid[i] = value;
  }
}

function isTimeInSpans(minute: number, spans: { start: number; end: number }[]): boolean {
  for (const span of spans) {
    if (span.end > span.start) {
      if (minute >= span.start && minute < span.end) return true;
    } else {
      if (minute >= span.start || minute < span.end) return true;
    }
  }
  return false;
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
    ticks += '╵';
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
  date?: string,
): string {
  const dayTriggers = triggers.filter(t => {
    if (!t.enabled) return false;
    if (t.date) return t.date === date;
    return t.days.includes(day);
  });
  const slotMinutes = slotDuration * 60;

  const dayWindows = getWindowsForDay(day, smartConfigs);
  const workSpans = dayWindows.map(w => ({
    start: parseTime(w.start),
    end: parseTime(w.end),
  }));

  const pingMinutes = new Set(dayTriggers.map(t => parseTime(t.time)));
  const renewalMinutes = new Set<number>();

  const allSlots: { start: number; end: number }[] = [];
  for (const t of dayTriggers) {
    const pingTime = parseTime(t.time);
    let currentStart = pingTime;
    const maxRenewals = Math.ceil(1440 / slotMinutes);
    for (let i = 0; i < maxRenewals; i++) {
      const end = (currentStart + slotMinutes) % 1440;
      allSlots.push({ start: currentStart, end });
      if (isTimeInSpans(end, workSpans) && !pingMinutes.has(end)) {
        renewalMinutes.add(end);
        currentStart = end;
      } else {
        break;
      }
    }
  }

  const grid: CellType[] = new Array(COLS).fill('empty');

  for (const span of allSlots) {
    fillGrid(grid, span.start, span.end, 'slot');
  }

  for (const span of workSpans) {
    fillGrid(grid, span.start, span.end, 'work');
  }

  for (const min of renewalMinutes) {
    const col = minuteToCol(min);
    if (col < COLS) grid[col] = 'renewal';
  }

  for (const min of pingMinutes) {
    const col = minuteToCol(min);
    if (col < COLS) grid[col] = 'ping';
  }

  const rowStr = grid.map(cell => {
    switch (cell) {
      case 'ping': return chalk.red('⚡');
      case 'renewal': return chalk.cyan('●');
      case 'work': return chalk.green('█');
      case 'slot': return chalk.gray('█');
      default: return ' ';
    }
  }).join('');

  const label = `  ${dayShort(day).padEnd(LABEL_WIDTH - 2)}`;
  return `${label}${rowStr}`;
}

export function renderTimeline(
  triggers: Trigger[],
  smartConfigs: SmartConfig[],
  slotDuration: number,
  days: DayOfWeek[],
  dates?: string[],
): string {
  const lines: string[] = [];
  const todayStr = todayDateString();

  const hasPings = days.some((day, i) => triggers.some(t => {
    if (!t.enabled) return false;
    if (t.date) return dates?.[i] === t.date;
    return t.days.includes(day);
  }));
  const hasWindows = days.some(day => getWindowsForDay(day, smartConfigs).length > 0);

  if (!hasPings && !hasWindows) {
    lines.push('');
    lines.push(chalk.bold('  Schedule Timeline'));
    lines.push('');
    lines.push(chalk.dim('  No pings or work windows scheduled.'));
    lines.push(chalk.dim('  Use "claude-shift add" or "claude-shift smart" to set up your schedule.'));
    lines.push('');
    return lines.join('\n');
  }

  let title = '  Schedule Timeline';
  if (dates && dates.length === 1) {
    title += ` — ${formatDateShort(dates[0]!)}`;
  } else if (dates && dates.length > 1) {
    title += ` — ${formatDateShort(dates[0]!)} to ${formatDateShort(dates[dates.length - 1]!)}`;
  }
  lines.push('');
  lines.push(chalk.bold(title));
  lines.push('');
  lines.push(`${''.padEnd(LABEL_WIDTH)}${renderHourHeader()}`);
  lines.push(`${''.padEnd(LABEL_WIDTH)}${renderHourTicks()}`);

  for (let i = 0; i < days.length; i++) {
    if (i > 0) lines.push('');
    const isToday = dates?.[i] === todayStr;
    const row = renderDayTimeline(days[i]!, triggers, smartConfigs, slotDuration, dates?.[i]);
    lines.push(isToday ? chalk.bold(row) + chalk.dim(' ◀ today') : row);
  }

  lines.push('');
  lines.push(chalk.dim(`  ${chalk.red('⚡')} ping  ${chalk.cyan('●')} renew  ${chalk.green('█')} work  ${chalk.gray('█')} slot (${slotDuration}h)`));
  lines.push('');

  return lines.join('\n');
}

export function renderToday(
  triggers: Trigger[],
  smartConfigs: SmartConfig[],
  slotDuration: number,
): string {
  const dateStr = todayDateString();
  return renderTimeline(triggers, smartConfigs, slotDuration, [dateToDayOfWeek(dateStr)], [dateStr]);
}
