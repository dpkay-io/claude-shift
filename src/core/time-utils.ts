import type { DayOfWeek } from '../config/schema.js';

const DAY_ORDER: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

export function parseTime(time: string): number {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid time format: "${time}" (expected HH:mm)`);
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Time out of range: "${time}"`);
  }
  return hours * 60 + minutes;
}

export function formatTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatTime12h(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`;
}

export function previousDay(day: DayOfWeek): DayOfWeek {
  const idx = DAY_ORDER.indexOf(day);
  return DAY_ORDER[(idx - 1 + 7) % 7]!;
}

export function nextDay(day: DayOfWeek): DayOfWeek {
  const idx = DAY_ORDER.indexOf(day);
  return DAY_ORDER[(idx + 1) % 7]!;
}

export function dayIndex(day: DayOfWeek): number {
  return DAY_ORDER.indexOf(day);
}

export function dayLabel(day: DayOfWeek): string {
  return DAY_LABELS[day];
}

export function dayShort(day: DayOfWeek): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

export function parseDays(input: string): DayOfWeek[] {
  const result = new Set<DayOfWeek>();
  const parts = input.toLowerCase().split(',').map(s => s.trim());
  for (const part of parts) {
    if (part === 'weekdays') {
      ['mon', 'tue', 'wed', 'thu', 'fri'].forEach(d => result.add(d as DayOfWeek));
      continue;
    }
    if (part === 'weekends') {
      ['sat', 'sun'].forEach(d => result.add(d as DayOfWeek));
      continue;
    }
    if (part === 'daily' || part === 'all') {
      DAY_ORDER.forEach(d => result.add(d));
      continue;
    }
    const range = part.match(/^(\w{3})-(\w{3})$/);
    if (range) {
      const start = DAY_ORDER.indexOf(range[1] as DayOfWeek);
      const end = DAY_ORDER.indexOf(range[2] as DayOfWeek);
      if (start === -1 || end === -1) throw new Error(`Invalid day range: "${part}"`);
      let i = start;
      while (true) {
        result.add(DAY_ORDER[i]!);
        if (i === end) break;
        i = (i + 1) % 7;
      }
      continue;
    }
    if (DAY_ORDER.includes(part as DayOfWeek)) {
      result.add(part as DayOfWeek);
      continue;
    }
    throw new Error(`Unknown day: "${part}". Use mon,tue,wed,thu,fri,sat,sun or weekdays,weekends,daily`);
  }
  return DAY_ORDER.filter(d => result.has(d));
}

export function sortDays(days: DayOfWeek[]): DayOfWeek[] {
  return DAY_ORDER.filter(d => days.includes(d));
}

export function formatDays(days: DayOfWeek[]): string {
  const sorted = sortDays(days);
  if (sorted.length === 7) return 'daily';
  if (sorted.length === 5 && sorted.every(d => ['mon', 'tue', 'wed', 'thu', 'fri'].includes(d))) return 'weekdays';
  if (sorted.length === 2 && sorted.every(d => ['sat', 'sun'].includes(d))) return 'weekends';
  return sorted.map(dayShort).join(', ');
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseDate(input: string): string {
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid date format: "${input}" (expected YYYY-MM-DD)`);
  const [, y, m, d] = match;
  const date = new Date(parseInt(y!, 10), parseInt(m!, 10) - 1, parseInt(d!, 10));
  if (isNaN(date.getTime())) throw new Error(`Invalid date: "${input}"`);
  return `${y}-${m}-${d}`;
}

export function formatDateShort(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${MONTH_NAMES[m! - 1]} ${d}, ${y}`;
}

export function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateToDayOfWeek(date: string): DayOfWeek {
  const dayNames: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  return dayNames[dt.getDay()]!;
}

export function getWeekDates(): string[] {
  const now = new Date();
  const dow = now.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
}
