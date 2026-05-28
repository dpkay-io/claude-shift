import { describe, it, expect } from 'vitest';
import { calculatePings, explainPing } from '../src/core/smart-calculator.js';
import type { DayOfWeek } from '../src/config/schema.js';

const weekdays: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

describe('calculatePings', () => {
  it('calculates a simple morning ping', () => {
    const pings = calculatePings(
      [{ start: '08:00', end: '13:00' }],
      weekdays,
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('03:00');
    expect(pings[0]!.days).toEqual(weekdays);
  });

  it('calculates evening ping', () => {
    const pings = calculatePings(
      [{ start: '20:00', end: '23:00' }],
      weekdays,
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('15:00');
  });

  it('handles multiple work windows', () => {
    const pings = calculatePings(
      [
        { start: '06:30', end: '08:00' },
        { start: '09:00', end: '11:00' },
        { start: '20:00', end: '23:00' },
      ],
      weekdays,
      5,
      2,
    );
    expect(pings).toHaveLength(3);
    expect(pings[0]!.time).toBe('01:30');
    expect(pings[1]!.time).toBe('04:00');
    expect(pings[2]!.time).toBe('15:00');
  });

  it('wraps to previous day when ping time goes negative', () => {
    const pings = calculatePings(
      [{ start: '04:00', end: '08:00' }],
      ['mon', 'tue'],
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('23:00');
    expect(pings[0]!.days).toEqual(['sun', 'mon']);
  });

  it('deduplicates pings at the same time', () => {
    const pings = calculatePings(
      [
        { start: '08:00', end: '10:00' },
        { start: '08:00', end: '12:00' },
      ],
      weekdays,
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('03:00');
  });
});

describe('explainPing', () => {
  it('generates readable explanation', () => {
    const ping = { time: '03:00', days: weekdays, targetSlotStart: '08:00', targetSlotEnd: '13:00' };
    const explanation = explainPing(ping, 5);
    expect(explanation).toContain('03:00');
    expect(explanation).toContain('08:00');
  });
});
