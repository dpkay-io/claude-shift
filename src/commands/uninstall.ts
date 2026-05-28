import { createScheduler } from '../scheduler/factory.js';
import * as display from '../utils/display.js';

export async function uninstallCommand(): Promise<void> {
  const scheduler = createScheduler();

  try {
    await scheduler.removeAll();
    display.success(`All claude-shift tasks removed from ${scheduler.name}.`);
  } catch (err) {
    display.error(`Failed to remove tasks: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
