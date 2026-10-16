import { describe, it, expect } from 'vitest';
import { dateOrderFromPattern, toSchtasksDate } from '../src/scheduler/schtasks.js';

describe('dateOrderFromPattern', () => {
  it.each([
    ['dd-MM-yyyy', 'DMY'],
    ['dd/MM/yyyy', 'DMY'],
    ['d.M.yyyy', 'DMY'],
    ['M/d/yyyy', 'MDY'],
    ['MM-dd-yy', 'MDY'],
    ['yyyy-MM-dd', 'YMD'],
    ['yyyy/M/d', 'YMD'],
  ])('%s → %s', (pattern, order) => {
    expect(dateOrderFromPattern(pattern)).toBe(order);
  });

  it('rejects patterns without a usable day/month/year order', () => {
    expect(dateOrderFromPattern('')).toBeNull();
    expect(dateOrderFromPattern('yyyy')).toBeNull();
    expect(dateOrderFromPattern('ddd')).toBeNull();
  });
});

describe('toSchtasksDate', () => {
  it('formats in the regional order with "/" separators', () => {
    expect(toSchtasksDate('2026-10-17', 'DMY')).toBe('17/10/2026');
    expect(toSchtasksDate('2026-10-17', 'MDY')).toBe('10/17/2026');
    expect(toSchtasksDate('2026-10-17', 'YMD')).toBe('2026/10/17');
  });
});
