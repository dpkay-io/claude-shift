import { loadConfig, getSmartConfigs } from '../config/manager.js';
import { renderTimeline } from '../core/timeline.js';
import { ALL_DAYS } from '../config/schema.js';
import { getWeekDates } from '../core/time-utils.js';

export function weekCommand(): void {
  const config = loadConfig();
  console.log(renderTimeline(config.triggers, getSmartConfigs(config), config.settings.slotDuration, ALL_DAYS, getWeekDates()));
}
