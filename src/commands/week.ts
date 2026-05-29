import { loadConfig } from '../config/manager.js';
import { renderTimeline } from '../core/timeline.js';
import { ALL_DAYS } from '../config/schema.js';
import { getWeekDates } from '../core/time-utils.js';

export function weekCommand(): void {
  const config = loadConfig();
  const smartConfigs = Array.isArray(config.smart) ? config.smart : config.smart ? [config.smart] : [];
  console.log(renderTimeline(config.triggers, smartConfigs, config.settings.slotDuration, ALL_DAYS, getWeekDates()));
}
