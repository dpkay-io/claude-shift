import { loadConfig } from '../config/manager.js';
import { createScheduler } from '../scheduler/factory.js';
import { printTriggerTable } from '../utils/display.js';
import chalk from 'chalk';

export async function listCommand(): Promise<void> {
  const config = loadConfig();
  const scheduler = createScheduler();
  const installed = await scheduler.list();
  console.log();
  console.log(chalk.bold('Configured triggers:'));
  console.log();
  printTriggerTable(config.triggers, installed);
  console.log();
}
