import { describe, it, expect } from 'vitest';
import { calculatePings, explainPing } from '../src/core/smart-calculator.js';
import type { DayOfWeek } from '../src/config/schema.js';

const weekdays: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

describe('calculatePings', () => {
  it('pre-burns for isolated windows using burn rate', () => {
    const pings = calculatePings(
      [{ start: '08:00', end: '13:00' }],
      weekdays,
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('05:00');
    expect(pings[0]!.days).toEqual(weekdays);
  });

  it('pre-burns for isolated evening window using burn rate', () => {
    const pings = calculatePings(
      [{ start: '20:00', end: '23:00' }],
      weekdays,
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('17:00');
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
    expect(pings[1]!.time).toBe('17:00');
  });

  it('pre-burns isolated window without day wrap when burn rate fits', () => {
    const pings = calculatePings(
      [{ start: '04:00', end: '08:00' }],
      ['mon', 'tue'],
      5,
      2,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('01:00');
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
    expect(pings[0]!.time).toBe('05:00');
  });

  it('skips pre-burn when burn rate equals slot duration', () => {
    const pings = calculatePings(
      [{ start: '20:00', end: '23:00' }],
      weekdays,
      5,
      5,
    );
    expect(pings).toHaveLength(1);
    expect(pings[0]!.time).toBe('20:00');
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

  it('applies burn-rate pre-burn when bridge strategy fails', () => {
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
    expect(pings[0]!.time).toBe('00:00');
    expect(pings[0]!.days).toEqual(weekdays);
    expect(pings[1]!.time).toBe('04:59');
    expect(pings[1]!.days).toEqual(weekdays);
  });

  it('uses burnRate pre-burn for short windows, slotDuration-burnRate for long', () => {
    const pings = calculatePings(
      [
        { start: '08:00', end: '10:00' },
        { start: '14:00', end: '17:00' },
      ],
      weekdays,
      5,
      2,
    );
    expect(pings).toHaveLength(2);
    expect(pings[0]!.time).toBe('06:00');
    expect(pings[1]!.time).toBe('11:00');
  });

  it('rejects midnight-spanning windows', () => {
    expect(() => calculatePings(
      [{ start: '23:00', end: '01:00' }],
      weekdays,
      5,
      2,
    )).toThrow(/start must be before end/);
  });

  it('rejects zero-length windows', () => {
    expect(() => calculatePings(
      [{ start: '08:00', end: '08:00' }],
      weekdays,
      5,
      2,
    )).toThrow(/start must be before end/);
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

  it('explains a pre-burn isolated window ping', () => {
    const ping = { time: '17:00', days: weekdays, targetSlotStart: '20:00', targetSlotEnd: '23:00' };
    const explanation = explainPing(ping, 5);
    expect(explanation).toContain('17:00');
    expect(explanation).toContain('22:00');
    expect(explanation).toContain('20:00');
    expect(explanation).toContain('23:00');
  });

  it('indicates day-before for overnight pings', () => {
    const ping = { time: '23:00', days: ['sun', 'mon', 'tue', 'wed', 'thu'] as DayOfWeek[], targetSlotStart: '02:00', targetSlotEnd: '03:00' };
    const explanation = explainPing(ping, 5);
    expect(explanation).toContain('(day before)');
    expect(explanation).toContain('23:00');
  });
});
