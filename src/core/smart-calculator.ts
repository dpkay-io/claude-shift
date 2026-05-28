import type { DayOfWeek, WorkWindow, Trigger } from '../config/schema.js';
import { parseTime, formatTime, previousDay } from './time-utils.js';

export interface CalculatedPing {
  time: string; // HH:mm
  days: DayOfWeek[];
  targetSlotStart: string;
  targetSlotEnd: string;
}

/**
 * Given work windows and a slot duration, calculate the ping times needed
 * to ensure fresh slots are available when work starts.
 *
 * The logic: to have a slot that ENDS at a specific time (so a fresh slot
 * starts right then), schedule a ping at (endTime - slotDuration).
 *
 * For the user's workflow:
 *   - Work 6:30-8:00 → want slot ending at 8:00 → ping at 3:00
 *   - Work 20:00-23:00 → want slot ending at ~21:30 → ping at 16:30
 *     (gives tail of dying slot + fresh slot for continuous coverage)
 *
 * The algorithm uses the work window start + burnRate to determine when
 * the user will exhaust their slot, then ensures a ping is placed so
 * the next slot is ready.
 */
export function calculatePings(
  windows: WorkWindow[],
  days: DayOfWeek[],
  slotDuration: number, // hours
  burnRate: number, // hours — how long user effectively uses a slot
): CalculatedPing[] {
  const slotMinutes = slotDuration * 60;
  const results: CalculatedPing[] = [];

  // Sort windows by start time
  const sorted = [...windows].sort((a, b) => parseTime(a.start) - parseTime(b.start));

  for (const window of sorted) {
    const windowStart = parseTime(window.start);
    const windowEnd = parseTime(window.end);
    const windowDuration = windowEnd > windowStart
      ? windowEnd - windowStart
      : (1440 - windowStart) + windowEnd; // crosses midnight

    // Determine how many slots this work window needs
    // and where to place pings so slot boundaries align well
    let coveredFrom = windowStart;
    let remaining = windowDuration;
    let isFirstSlot = true;

    while (remaining > 0) {
      if (isFirstSlot) {
        // For the first slot of a work window, we want a ping scheduled
        // slotDuration before the window starts, so the "waste" slot expires
        // right when work begins = fresh slot available
        let pingMinutes = windowStart - slotMinutes;
        let pingDays = [...days];

        if (pingMinutes < 0) {
          pingMinutes += 1440;
          pingDays = days.map(d => previousDay(d));
        }

        results.push({
          time: formatTime(pingMinutes),
          days: pingDays,
          targetSlotStart: window.start,
          targetSlotEnd: window.end,
        });

        // After the fresh slot starts at windowStart, user works for burnRate hours
        // or until window ends, whichever is shorter
        const thisChunk = Math.min(burnRate * 60, remaining);
        coveredFrom = (coveredFrom + thisChunk) % 1440;
        remaining -= thisChunk;
        isFirstSlot = false;
      } else {
        // Subsequent slots within the same window chain naturally
        // (previous slot expires → new one starts when user continues working)
        // No ping needed — the slot starts on next usage
        const thisChunk = Math.min(burnRate * 60, remaining);
        coveredFrom = (coveredFrom + thisChunk) % 1440;
        remaining -= thisChunk;
      }
    }
  }

  return deduplicatePings(results);
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
  const slotEnd = formatTime(pingMinutes + slotDuration * 60);
  return `Ping at ${ping.time} → slot runs ${ping.time}–${slotEnd} → fresh slot available at ${slotEnd} for your ${ping.targetSlotStart}–${ping.targetSlotEnd} window`;
}
