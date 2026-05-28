import { loadConfig, saveConfig, addTrigger } from '../config/manager.js';
import { parseTime, parseDays, formatTime12h, formatDays } from '../core/time-utils.js';
import type { DayOfWeek } from '../config/schema.js';
import * as display from '../utils/display.js';

export function addCommand(time: string, options: { days?: string }): void {
  parseTime(time); // validate

  const days: DayOfWeek[] = options.days ? parseDays(options.days) : parseDays('weekdays');
  const config = loadConfig();

  const trigger = addTrigger(config, {
    time,
    days,
    source: 'manual',
    enabled: true,
  });

  saveConfig(config);

  display.success(`Trigger ${trigger.id} added: ping at ${formatTime12h(parseTime(time))} on ${formatDays(days)}`);
  display.info('Run `claude-shift install` to activate with your OS scheduler.');
}
