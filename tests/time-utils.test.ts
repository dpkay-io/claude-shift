import { describe, it, expect } from 'vitest';
import {
  parseTime, formatTime, formatTime12h,
  previousDay, nextDay, parseDays, formatDays, sortDays,
} from '../src/core/time-utils.js';

describe('parseTime', () => {
  it('parses valid HH:mm', () => {
    expect(parseTime('03:00')).toBe(180);
    expect(parseTime('0:00')).toBe(0);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('12:30')).toBe(750);
  });

  it('parses single-digit hours consistently', () => {
    expect(parseTime('9:59')).toBe(599);
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('0:00')).toBe(0);
  });

  it('rejects invalid formats', () => {
    expect(() => parseTime('25:00')).toThrow();
    expect(() => parseTime('abc')).toThrow();
    expect(() => parseTime('12:60')).toThrow();
    expect(() => parseTime('12:30:00')).toThrow();
    expect(() => parseTime('-1:00')).toThrow();
    expect(() => parseTime('12 :30')).toThrow();
  });
});

describe('formatTime', () => {
  it('formats minutes to HH:mm', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(180)).toBe('03:00');
    expect(formatTime(1439)).toBe('23:59');
  });

  it('handles negative/overflow via wrapping', () => {
    expect(formatTime(-60)).toBe('23:00');
    expect(formatTime(1500)).toBe('01:00');
  });

  it('handles exact midnight boundary (1440)', () => {
    expect(formatTime(1440)).toBe('00:00');
  });
});

describe('formatTime12h', () => {
  it('formats correctly', () => {
    expect(formatTime12h(0)).toBe('12am');
    expect(formatTime12h(180)).toBe('3am');
    expect(formatTime12h(720)).toBe('12pm');
    expect(formatTime12h(810)).toBe('1:30pm');
    expect(formatTime12h(1380)).toBe('11pm');
  });
});

describe('previousDay / nextDay', () => {
  it('wraps correctly', () => {
    expect(previousDay('mon')).toBe('sun');
    expect(previousDay('sun')).toBe('sat');
    expect(nextDay('sun')).toBe('mon');
    expect(nextDay('sat')).toBe('sun');
  });
});

describe('parseDays', () => {
  it('parses weekdays shorthand', () => {
    expect(parseDays('weekdays')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
  });

  it('parses weekends shorthand', () => {
    expect(parseDays('weekends')).toEqual(['sat', 'sun']);
  });

  it('parses ranges', () => {
    expect(parseDays('mon-wed')).toEqual(['mon', 'tue', 'wed']);
  });

  it('parses comma-separated', () => {
    expect(parseDays('mon,wed,fri')).toEqual(['mon', 'wed', 'fri']);
  });

  it('parses daily', () => {
    expect(parseDays('daily')).toHaveLength(7);
  });

  it('rejects invalid days', () => {
    expect(() => parseDays('foo')).toThrow();
  });

  it('handles wrap-around ranges', () => {
    const result = parseDays('fri-mon');
    expect(result).toEqual(['mon', 'fri', 'sat', 'sun']);
  });

  it('deduplicates entries', () => {
    expect(parseDays('mon,mon,mon')).toEqual(['mon']);
  });
});

describe('formatDays', () => {
  it('shows weekdays shorthand', () => {
    expect(formatDays(['mon', 'tue', 'wed', 'thu', 'fri'])).toBe('weekdays');
  });

  it('shows weekends shorthand', () => {
    expect(formatDays(['sat', 'sun'])).toBe('weekends');
  });

  it('shows daily for all 7', () => {
    expect(formatDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).toBe('daily');
  });

  it('lists individual days otherwise', () => {
    expect(formatDays(['mon', 'fri'])).toBe('Mon, Fri');
  });

  it('formats a single day', () => {
    expect(formatDays(['wed'])).toBe('Wed');
  });
});

describe('sortDays', () => {
  it('sorts in week order', () => {
    expect(sortDays(['fri', 'mon', 'wed'])).toEqual(['mon', 'wed', 'fri']);
  });
});
