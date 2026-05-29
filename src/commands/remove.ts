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

  let schedulerFailed = false;
  try {
    const scheduler = createScheduler();
    await scheduler.remove(id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('No such file')) {
      // Not installed in scheduler — that's fine
    } else {
      display.warn(`Scheduler removal failed: ${msg}. Trigger removed from config only.`);
      schedulerFailed = true;
    }
  }

  saveConfig(config);
  if (schedulerFailed) {
    display.info(`Trigger ${id} removed from config. Run \`claude-shift uninstall\` to clean scheduler.`);
  } else {
    display.success(`Trigger ${id} removed.`);
  }
}
