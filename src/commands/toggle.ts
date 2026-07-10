import { loadConfig, saveConfig, setTriggerEnabled } from '../config/manager.js';
import { createScheduler } from '../scheduler/factory.js';
import { formatTime12h, formatDays, parseTime, formatDateShort } from '../core/time-utils.js';
import * as display from '../utils/display.js';

function describeTrigger(trigger: { time: string; days: string[]; date?: string }): string {
  const time = formatTime12h(parseTime(trigger.time));
  if (trigger.date) return `${time} on ${formatDateShort(trigger.date)} (once)`;
  return `${time} on ${formatDays(trigger.days as import('../config/schema.js').DayOfWeek[])}`;
}

export async function enableCommand(id: string): Promise<void> {
  const config = loadConfig();
  const trigger = setTriggerEnabled(config, id, true);

  if (!trigger) {
    display.error(`Trigger "${id}" not found.`);
    process.exitCode = 1;
    return;
  }

  saveConfig(config);
  display.success(`Trigger ${id} enabled: ${describeTrigger(trigger)}`);
  display.info('Run `claude-shift install` to activate with your OS scheduler.');
}

export async function disableCommand(id: string): Promise<void> {
  const config = loadConfig();
  const trigger = setTriggerEnabled(config, id, false);

  if (!trigger) {
    display.error(`Trigger "${id}" not found.`);
    process.exitCode = 1;
    return;
  }

  try {
    const scheduler = createScheduler();
    await scheduler.remove(id);
  } catch {
    // Not installed or scheduler unavailable — fine
  }

  saveConfig(config);
  display.success(`Trigger ${id} disabled: ${describeTrigger(trigger)}`);
}
