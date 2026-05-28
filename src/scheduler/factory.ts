import { detectPlatform } from '../utils/platform.js';
import type { SchedulerBackend } from './types.js';
import { CronScheduler } from './cron.js';
import { LaunchdScheduler } from './launchd.js';
import { SchtasksScheduler } from './schtasks.js';

export function createScheduler(): SchedulerBackend {
  const platform = detectPlatform();
  switch (platform) {
    case 'windows': return new SchtasksScheduler();
    case 'macos': return new LaunchdScheduler();
    case 'linux': return new CronScheduler();
  }
}
