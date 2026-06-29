import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectLimitHit, parseResetTime } from '../src/core/ping.js';

describe('detectLimitHit', () => {
  it('returns null for empty/undefined input', () => {
    expect(detectLimitHit(undefined)).toBeNull();
    expect(detectLimitHit('')).toBeNull();
  });

  it('returns null for normal responses', () => {
    expect(detectLimitHit('Got your ping message')).toBeNull();
    expect(detectLimitHit('Hello! I received your ping.')).toBeNull();
    expect(detectLimitHit('Session started successfully')).toBeNull();
  });

  it('detects monthly spend limit', () => {
    const resp = "> ~ highautomodeon ⎿ You've hit your monthly spend limit. /usage-credits to adjust your monthly spend limit. > ~ highautomodeon ·←foragents";
    const result = detectLimitHit(resp);
    expect(result).toEqual({ type: 'monthly', retryable: false });
  });

  it('detects monthly limit with different casing', () => {
    expect(detectLimitHit("You've Hit Your Monthly Spend Limit")).toEqual({ type: 'monthly', retryable: false });
    expect(detectLimitHit('MONTHLY SPEND LIMIT reached')).toEqual({ type: 'monthly', retryable: false });
  });

  it('detects weekly limit', () => {
    const resp = "Fiddle- > ~ highautomodeon ⎿ You've hit your weekly limit · resets Jun 28, 7:30pm (Asia/Calcutta) /upgrade to increase your usage limit. > ~ highautomodeon ·←foragents";
    const result = detectLimitHit(resp);
    expect(result).toEqual({ type: 'weekly', retryable: true });
  });

  it('detects daily limit', () => {
    const result = detectLimitHit("You've hit your daily limit · resets tomorrow at 12:00am");
    expect(result).toEqual({ type: 'daily', retryable: true });
  });

  it('detects unknown limit via catch-all pattern', () => {
    expect(detectLimitHit("You've hit your usage limit")).toEqual({ type: 'unknown', retryable: true });
    expect(detectLimitHit('Rate limit reached')).toEqual({ type: 'unknown', retryable: true });
    expect(detectLimitHit('You have exceeded your limit')).toEqual({ type: 'unknown', retryable: true });
  });

  it('does not false-positive on unrelated text containing "limit"', () => {
    expect(detectLimitHit('The character limit is 500')).toBeNull();
    expect(detectLimitHit('No limit on retries')).toBeNull();
  });

  it('prioritizes monthly over catch-all', () => {
    const resp = "You've hit your monthly spend limit";
    const result = detectLimitHit(resp);
    expect(result!.type).toBe('monthly');
    expect(result!.retryable).toBe(false);
  });

  it('prioritizes weekly over catch-all', () => {
    const resp = "You've hit your weekly limit";
    const result = detectLimitHit(resp);
    expect(result!.type).toBe('weekly');
  });
});

describe('parseResetTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 27, 10, 0, 0)); // Jun 27, 2026 10:00 AM
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for empty/undefined input', () => {
    expect(parseResetTime(undefined)).toBeNull();
    expect(parseResetTime('')).toBeNull();
  });

  it('returns null when no reset time pattern found', () => {
    expect(parseResetTime("You've hit your monthly spend limit.")).toBeNull();
    expect(parseResetTime('Try again later')).toBeNull();
  });

  it('parses "resets Jun 28, 7:30pm" format', () => {
    const resp = "You've hit your weekly limit · resets Jun 28, 7:30pm (Asia/Calcutta)";
    const result = parseResetTime(resp);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2026);
    expect(result!.getMonth()).toBe(5); // June = 5
    expect(result!.getDate()).toBe(28);
    expect(result!.getHours()).toBe(19); // 7pm = 19
    expect(result!.getMinutes()).toBe(30);
  });

  it('parses AM times correctly', () => {
    const result = parseResetTime('resets Jul 1, 12:00am');
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(0);
    expect(result!.getMinutes()).toBe(0);
  });

  it('parses 12pm correctly (noon)', () => {
    const result = parseResetTime('resets Jul 1, 12:30pm');
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(12);
    expect(result!.getMinutes()).toBe(30);
  });

  it('parses uppercase AM/PM', () => {
    const result = parseResetTime('resets Jul 5, 3:00PM');
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(15);
  });

  it('parses various month names', () => {
    expect(parseResetTime('resets Jan 1, 8:00am')!.getMonth()).toBe(0);
    expect(parseResetTime('resets Feb 15, 9:00am')!.getMonth()).toBe(1);
    expect(parseResetTime('resets Mar 10, 10:00am')!.getMonth()).toBe(2);
    expect(parseResetTime('resets December 25, 6:00pm')!.getMonth()).toBe(11);
  });

  it('handles full month names by matching first 3 chars', () => {
    const result = parseResetTime('resets January 5, 2:00pm');
    expect(result).not.toBeNull();
    expect(result!.getMonth()).toBe(0);
  });

  it('wraps to next year if parsed date is more than 24h in the past', () => {
    vi.setSystemTime(new Date(2026, 11, 30, 10, 0, 0)); // Dec 30, 2026
    const result = parseResetTime('resets Jan 3, 5:00pm');
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2027);
    expect(result!.getMonth()).toBe(0);
    expect(result!.getDate()).toBe(3);
  });

  it('does not wrap to next year if date is in the future', () => {
    const result = parseResetTime('resets Jun 28, 7:30pm');
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2026);
  });

  it('handles reset in embedded response text', () => {
    const resp = "Fiddle- > ~ highautomodeon ⎿ You've hit your weekly limit · resets Jun 28, 7:30pm (Asia/Calcutta) /upgrade to increase your usage limit. > ~ highautomodeon ·←foragents";
    const result = parseResetTime(resp);
    expect(result).not.toBeNull();
    expect(result!.getMonth()).toBe(5);
    expect(result!.getDate()).toBe(28);
    expect(result!.getHours()).toBe(19);
    expect(result!.getMinutes()).toBe(30);
  });

  it('returns null for invalid month name', () => {
    expect(parseResetTime('resets Xyz 5, 2:00pm')).toBeNull();
  });
});
