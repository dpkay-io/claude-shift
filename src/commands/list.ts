import { loadConfig } from '../config/manager.js';
import { createScheduler } from '../scheduler/factory.js';
import { printTriggerTable } from '../utils/display.js';
import chalk from 'chalk';

export async function listCommand(): Promise<void> {
  const config = loadConfig();
  const scheduler = createScheduler();
  let installed: Awaited<ReturnType<typeof scheduler.list>> = [];
  try {
    installed = await scheduler.list();
  } catch {
    // Scheduler unavailable — show config-only view
  }
  console.log();
  console.log(chalk.bold('Configured triggers:'));
  console.log();
  printTriggerTable(config.triggers, installed);
  console.log();
}
