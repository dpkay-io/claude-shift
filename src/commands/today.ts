import { loadConfig, getSmartConfigs } from '../config/manager.js';
import { renderToday } from '../core/timeline.js';

export function todayCommand(): void {
  const config = loadConfig();
  console.log(renderToday(config.triggers, getSmartConfigs(config), config.settings.slotDuration));
}
