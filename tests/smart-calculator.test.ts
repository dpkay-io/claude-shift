import { describe, it, expect } from 'vitest';
import { calculatePings, explainPing } from '../src/core/smart-calculator.js';
import type { DayOfWeek } from '../src/config/schema.js';

const weekdays: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

describe('calculatePings', () => {
  it('pings at window start for isolated windows', () => {
    const pings = calculatePings(
      [{ start: '08:00', end: '13:00' }],
      weekdays,
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('08:00');
    expect(pings[0]!.days).toEqual(weekdays);
  });

  it('pings at window start for evening window', () => {
    const pings = calculatePings(
      [{ start: '20:00', end: '23:00' }],
      weekdays,
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('20:00');
  });

  it('consolidates consecutive windows with one pre-burn ping', () => {
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
    expect(pings).toHaveLength(2);
    expect(pings[0]!.time).toBe('04:00');
    expect(pings[1]!.time).toBe('20:00');
  });

  it('does not wrap to previous day for isolated windows', () => {
    const pings = calculatePings(
      [{ start: '04:00', end: '08:00' }],
      ['mon', 'tue'],
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('04:00');
    expect(pings[0]!.days).toEqual(['mon', 'tue']);
  });

  it('wraps pre-burn to previous day when needed', () => {
    const pings = calculatePings(
      [
        { start: '03:00', end: '04:00' },
        { start: '04:30', end: '06:00' },
      ],
      ['mon', 'tue'],
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('23:30');
    expect(pings[0]!.days).toEqual(['sun', 'mon']);
  });

  it('merges overlapping windows', () => {
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
    expect(pings[0]!.time).toBe('08:00');
  });

  it('pre-burns for a consecutive pair', () => {
    const pings = calculatePings(
      [
        { start: '07:00', end: '08:00' },
        { start: '09:00', end: '11:00' },
      ],
      weekdays,
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('04:00');
  });

  it('falls back to window-start pings when pre-burn cannot cover', () => {
    const pings = calculatePings(
      [
        { start: '02:00', end: '03:00' },
        { start: '07:59', end: '10:00' },
      ],
      weekdays,
      5,
      2,
    );
    expect(pings).toHaveLength(2);
    expect(pings[0]!.time).toBe('02:00');
    expect(pings[1]!.time).toBe('07:59');
  });
});

describe('explainPing', () => {
  it('generates readable explanation', () => {
    const ping = { time: '04:00', days: weekdays, targetSlotStart: '06:30', targetSlotEnd: '11:00' };
    const explanation = explainPing(ping, 5);
    expect(explanation).toContain('04:00');
    expect(explanation).toContain('09:00');
    expect(explanation).toContain('06:30');
  });

  it('explains an isolated window ping', () => {
    const ping = { time: '20:00', days: weekdays, targetSlotStart: '20:00', targetSlotEnd: '23:00' };
    const explanation = explainPing(ping, 5);
    expect(explanation).toContain('20:00');
    expect(explanation).toContain('01:00');
    expect(explanation).toContain('23:00');
  });
});
