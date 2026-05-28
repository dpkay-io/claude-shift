import { loadConfig, saveConfig, removeTrigger } from '../config/manager.js';
import { createScheduler } from '../scheduler/factory.js';
import * as display from '../utils/display.js';

export async function removeCommand(id: string): Promise<void> {
  const config = loadConfig();
  const trigger = removeTrigger(config, id);

  if (!trigger) {
    display.error(`Trigger "${id}" not found.`);
    process.exitCode = 1;
    return;
  }

  // Also remove from OS scheduler if installed
  try {
    const scheduler = createScheduler();
    await scheduler.remove(id);
  } catch {
    // Not installed in scheduler — that's fine
  }

  saveConfig(config);
  display.success(`Trigger ${id} removed.`);
}
