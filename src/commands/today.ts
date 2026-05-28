import { loadConfig } from '../config/manager.js';
import { renderToday } from '../core/timeline.js';

export function todayCommand(): void {
  const config = loadConfig();
  const smartConfigs = Array.isArray(config.smart) ? config.smart : config.smart ? [config.smart] : [];
  console.log(renderToday(config.triggers, smartConfigs, config.settings.slotDuration));
}
