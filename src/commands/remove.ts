import { loadConfig, saveConfig, removeTrigger } from '../config/manager.js';
import { createScheduler } from '../scheduler/factory.js';
import { formatTime12h, formatDays, formatDateShort, parseTime } from '../core/time-utils.js';
import type { DayOfWeek } from '../config/schema.js';
import * as display from '../utils/display.js';
import { toErrorMessage } from '../utils/text.js';

export async function removeCommand(id: string): Promise<void> {
  const config = loadConfig();
  const trigger = removeTrigger(config, id);

  if (!trigger) {
    display.error(`Trigger "${id}" not found.`);
    process.exitCode = 1;
    return;
  }

  let schedulerFailed = false;
  try {
    const scheduler = createScheduler();
    await scheduler.remove(id);
  } catch (err) {
    const msg = toErrorMessage(err);
    if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('No such file')) {
      // Not installed in scheduler — that's fine
    } else {
      display.warn(`Scheduler removal failed: ${msg}. Trigger removed from config only.`);
      schedulerFailed = true;
    }
  }

  saveConfig(config);

  const timeLabel = formatTime12h(parseTime(trigger.time));
  const schedule = trigger.date
    ? `${timeLabel} on ${formatDateShort(trigger.date)} (once)`
    : `${timeLabel} on ${formatDays(trigger.days as DayOfWeek[])}`;

  if (schedulerFailed) {
    display.info(`Trigger ${id} removed from config (${schedule}). Run \`claude-shift uninstall\` to clean scheduler.`);
  } else {
    display.success(`Trigger ${id} removed (${schedule}).`);
  }
}
