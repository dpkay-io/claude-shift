import { loadConfig, saveConfig, addTrigger, findDuplicateTrigger } from '../config/manager.js';
import { parseTime, parseDays, parseDate, formatTime12h, formatDays, formatDateShort, todayDateString } from '../core/time-utils.js';
import type { DayOfWeek } from '../config/schema.js';
import * as display from '../utils/display.js';
import { toErrorMessage } from '../utils/text.js';

export function addCommand(time: string, options: { days?: string; once?: string | true }): void {
  let days: DayOfWeek[];
  let date: string | undefined;
  try {
    parseTime(time);
    if (options.once !== undefined) {
      if (options.days) {
        display.error('Cannot use --once with --days.');
        process.exitCode = 1;
        return;
      }
      date = typeof options.once === 'string' ? parseDate(options.once) : todayDateString();
      const today = todayDateString();
      if (date < today) {
        display.error(`Date ${formatDateShort(date)} is in the past.`);
        process.exitCode = 1;
        return;
      }
      days = [];
    } else {
      days = options.days ? parseDays(options.days) : parseDays('weekdays');
    }
  } catch (e) {
    display.error(toErrorMessage(e));
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();

  if (!date) {
    const dup = findDuplicateTrigger(config, time, days);
    if (dup) {
      display.warn(`A trigger at ${formatTime12h(parseTime(time))} on ${formatDays(days)} already exists (ID ${dup.id}).`);
    }
  }

  const trigger = addTrigger(config, {
    time,
    days,
    source: 'manual',
    enabled: true,
    ...(date ? { date } : {}),
  });

  saveConfig(config);

  if (date) {
    display.success(`Trigger ${trigger.id} added: one-time ping at ${formatTime12h(parseTime(time))} on ${formatDateShort(date)}`);
  } else {
    display.success(`Trigger ${trigger.id} added: ping at ${formatTime12h(parseTime(time))} on ${formatDays(days)}`);
  }
  display.info('Run `claude-shift install` to activate with your OS scheduler.');
}
