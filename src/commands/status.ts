import { loadConfig } from '../config/manager.js';
import { createScheduler } from '../scheduler/factory.js';
import { readRecentLogs } from '../logger/index.js';
import { printTriggerTable } from '../utils/display.js';
import * as display from '../utils/display.js';
import chalk from 'chalk';

export async function statusCommand(): Promise<void> {
  const config = loadConfig();
  const scheduler = createScheduler();

  console.log();
  console.log(chalk.bold(`Platform: ${scheduler.name}`));
  console.log();

  // Check scheduler availability
  const check = await scheduler.check();
  if (check.available) {
    display.success(`${scheduler.name} is available`);
  } else {
    display.error(`${scheduler.name} unavailable: ${check.reason}`);
  }

  // Fetch installed tasks
  const installed = await scheduler.list();

  // Show configured triggers (with installation status)
  console.log();
  console.log(chalk.bold('Configured triggers:'));
  console.log();
  printTriggerTable(config.triggers, installed);

  // Show installed tasks
  console.log();
  console.log(chalk.bold('Installed in scheduler:'));
  if (installed.length === 0) {
    console.log(chalk.dim('  No tasks installed. Run `claude-shift install`.'));
  } else {
    for (const task of installed) {
      const statusIcon = task.status === 'active' ? chalk.green('●') : chalk.dim('○');
      console.log(`  ${statusIcon} ${task.id} (${task.status})`);
    }
  }

  // Show recent logs
  console.log();
  console.log(chalk.bold('Recent ping log:'));
  const logs = readRecentLogs(5);
  if (logs.length === 0) {
    console.log(chalk.dim('  No pings recorded yet.'));
  } else {
    for (const log of logs) {
      console.log(chalk.dim(`  ${log}`));
    }
  }

  console.log();
}
