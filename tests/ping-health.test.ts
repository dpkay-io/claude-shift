import { describe, expect, it } from 'vitest';
import { summarizePingHealth } from '../src/core/ping-health.js';

const line = (time: string, rest: string): string => `[2026-11-09 ${time}] ${rest}`;
const ping = (time: string, status: string, trigger = '062'): string => line(time, `PING trigger=${trigger} status=${status} detail="exit=0 duration=1000ms"`);

describe('summarizePingHealth', () => {
  it('has no history for an empty log', () => {
    expect(summarizePingHealth([])).toEqual({ consecutiveFailures: 0 });
  });

  it('is healthy when the latest ping succeeded', () => {
    const health = summarizePingHealth([ping('05:00:01', 'starting'), ping('05:00:09', 'success')]);
    expect(health).toEqual({ lastSuccess: '2026-11-09 05:00:09', consecutiveFailures: 0 });
  });

  it('counts failures since the last success, including limit hits', () => {
    const health = summarizePingHealth([
      ping('04:00:09', 'success'),
      ping('05:00:09', 'error'),
      ping('05:05:09', 'error'),
      ping('06:00:09', 'limit-weekly'),
    ]);
    expect(health).toEqual({ lastSuccess: '2026-11-09 04:00:09', consecutiveFailures: 3 });
  });

  it('resets the streak when a ping succeeds again', () => {
    expect(summarizePingHealth([ping('05:00:09', 'error'), ping('06:00:09', 'success')]).consecutiveFailures).toBe(0);
  });

  it('reports failures with no success on record', () => {
    expect(summarizePingHealth([ping('05:00:09', 'error')])).toEqual({ consecutiveFailures: 1 });
  });

  it('ignores starting, retry bookkeeping, skips and unrelated lines', () => {
    const health = summarizePingHealth([
      ping('05:00:09', 'success'),
      ping('05:30:00', 'starting'),
      line('05:30:01', 'RETRY trigger=062 status=scheduled detail="attempt 1/5"'),
      line('05:30:02', 'SKIP another ping is running (lock held)'),
      'garbage',
      '',
    ]);
    expect(health).toEqual({ lastSuccess: '2026-11-09 05:00:09', consecutiveFailures: 0 });
  });

  it('understands retry and limit-retry ping lines', () => {
    const health = summarizePingHealth([
      line('05:45:09', 'PING trigger=062 retry=4 status=error detail="exit=1"'),
      line('06:00:09', 'PING trigger=062 limit-retry status=success detail="exit=0"'),
    ]);
    expect(health).toEqual({ lastSuccess: '2026-11-09 06:00:09', consecutiveFailures: 0 });
  });
});
