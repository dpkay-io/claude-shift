import type { DayOfWeek, WorkWindow, Trigger } from '../config/schema.js';
import { parseTime, formatTime, previousDay } from './time-utils.js';

export interface CalculatedPing {
  time: string; // HH:mm
  days: DayOfWeek[];
  targetSlotStart: string;
  targetSlotEnd: string;
}

/**
 * Given work windows and a slot duration, calculate optimal ping times.
 *
 * For isolated windows (gap > slotDuration from neighbors), the ping fires
 * at the window start — a fresh slot begins right when work does, zero waste.
 *
 * For consecutive windows (gap < slotDuration), a single pre-burn ping is
 * placed so the slot expires at the next window's start, giving a fresh slot
 * exactly when the next work block begins.
 */
export function calculatePings(
  windows: WorkWindow[],
  days: DayOfWeek[],
  slotDuration: number, // hours
  burnRate: number, // hours — kept for API compatibility
): CalculatedPing[] {
  const slotMinutes = slotDuration * 60;
  const results: CalculatedPing[] = [];

  const sorted = [...windows].sort((a, b) => parseTime(a.start) - parseTime(b.start));
  const merged = mergeOverlapping(sorted);
  const chains = groupChains(merged, slotMinutes);

  for (const chain of chains) {
    let slotExpiry = -1;

    for (let i = 0; i < chain.length; i++) {
      const window = chain[i]!;
      const windowStart = parseTime(window.start);

      if (slotExpiry >= windowStart) continue;

      const nextWindow = i + 1 < chain.length ? chain[i + 1]! : undefined;

      if (nextWindow) {
        const nextStart = parseTime(nextWindow.start);
        const rawPing = nextStart - slotMinutes;

        if (rawPing <= windowStart) {
          let pingMinutes = rawPing;
          let pingDays = [...days];
          if (pingMinutes < 0) {
            pingMinutes += 1440;
            pingDays = days.map(d => previousDay(d));
          }
          results.push({
            time: formatTime(pingMinutes),
            days: pingDays,
            targetSlotStart: window.start,
            targetSlotEnd: nextWindow.end,
          });
          slotExpiry = nextStart + slotMinutes;
          continue;
        }
      }

      results.push({
        time: formatTime(windowStart),
        days: [...days],
        targetSlotStart: window.start,
        targetSlotEnd: window.end,
      });
      slotExpiry = windowStart + slotMinutes;
    }
  }

  return deduplicatePings(results);
}

function mergeOverlapping(sorted: WorkWindow[]): WorkWindow[] {
  if (sorted.length === 0) return [];
  const result: WorkWindow[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = sorted[i]!;
    if (parseTime(curr.start) <= parseTime(prev.end)) {
      if (parseTime(curr.end) > parseTime(prev.end)) {
        prev.end = curr.end;
      }
    } else {
      result.push({ ...curr });
    }
  }
  return result;
}

function groupChains(windows: WorkWindow[], slotMinutes: number): WorkWindow[][] {
  if (windows.length === 0) return [];
  const chains: WorkWindow[][] = [[windows[0]!]];
  for (let i = 1; i < windows.length; i++) {
    const lastChain = chains[chains.length - 1]!;
    const lastWindow = lastChain[lastChain.length - 1]!;
    const gap = parseTime(windows[i]!.start) - parseTime(lastWindow.end);
    if (gap < slotMinutes) {
      lastChain.push(windows[i]!);
    } else {
      chains.push([windows[i]!]);
    }
  }
  return chains;
}

function deduplicatePings(pings: CalculatedPing[]): CalculatedPing[] {
  const map = new Map<string, CalculatedPing>();

  for (const ping of pings) {
    const key = ping.time;
    const existing = map.get(key);
    if (existing) {
      const allDays = new Set([...existing.days, ...ping.days]);
      existing.days = [...allDays];
      existing.targetSlotStart = ping.targetSlotStart;
      existing.targetSlotEnd = ping.targetSlotEnd;
    } else {
      map.set(key, { ...ping, days: [...ping.days] });
    }
  }

  return [...map.values()].sort((a, b) => parseTime(a.time) - parseTime(b.time));
}

export function explainPing(ping: CalculatedPing, slotDuration: number): string {
  const pingMinutes = parseTime(ping.time);
  const slotEnd = formatTime((pingMinutes + slotDuration * 60) % 1440);
  return `Ping at ${ping.time} → slot ${ping.time}–${slotEnd} for your ${ping.targetSlotStart}–${ping.targetSlotEnd} window`;
}
