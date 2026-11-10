import { loadConfig } from '../config/manager.js';
import { createScheduler } from '../scheduler/factory.js';
import { readRecentLogs } from '../logger/index.js';
import { summarizePingHealth } from '../core/ping-health.js';
import * as display from '../utils/display.js';
import chalk from 'chalk';

// ping.log keeps at most this many lines (see logger), so this reads all of it.
const HEALTH_LOG_LINES = 500;
const FAILURE_WARNING_THRESHOLD = 3;

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
  display.printTriggerTable(config.triggers, installed);

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

  // The few lines above can hide a long failing streak, so state it outright.
  const health = summarizePingHealth(readRecentLogs(HEALTH_LOG_LINES));
  if (health.consecutiveFailures >= FAILURE_WARNING_THRESHOLD) {
    const since = health.lastSuccess ? `last success: ${health.lastSuccess}` : 'no success on record';
    display.warn(`The last ${health.consecutiveFailures} pings failed (${since}). Run \`claude-shift ping\` to see why.`);
  } else if (health.lastSuccess) {
    display.success(`Last successful ping: ${health.lastSuccess}`);
  }

  console.log();
}
