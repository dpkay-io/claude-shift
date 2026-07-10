#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { addCommand } from './commands/add.js';
import { smartCommand } from './commands/smart.js';
import { listCommand } from './commands/list.js';
import { removeCommand } from './commands/remove.js';
import { installCommand } from './commands/install.js';
import { uninstallCommand } from './commands/uninstall.js';
import { statusCommand } from './commands/status.js';
import { pingCommand } from './commands/ping.js';
import { todayCommand } from './commands/today.js';
import { weekCommand } from './commands/week.js';
import { configGetCommand, configSetCommand } from './commands/config.js';
import { enableCommand, disableCommand } from './commands/toggle.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };
const program = new Command();

program
  .name('claude-shift')
  .description('Optimize your Claude Max 5-hour slots by scheduling strategic session pings')
  .version(pkg.version);

program
  .command('init')
  .description('Interactive setup wizard')
  .action(initCommand);

program
  .command('add <time>')
  .description('Add a manual ping trigger (time in HH:mm format)')
  .option('-d, --days <days>', 'Days to run (e.g., weekdays, mon-fri, mon,wed,fri) — default: weekdays')
  .option('--once [date]', 'One-time trigger (default: today, or specify YYYY-MM-DD)')
  .action(addCommand);

program
  .command('smart')
  .description('Configure smart mode — provide your work windows, get optimal ping times')
  .requiredOption('-s, --slots <slots>', 'Work windows (e.g., "06:30-08:00,09:00-11:00,20:00-23:00")')
  .option('-d, --days <days>', 'Days to apply (e.g., weekdays, mon-fri)', 'weekdays')
  .option('-b, --burn-rate <hours>', 'How many hours a slot typically lasts for you')
  .option('-y, --yes', 'Skip confirmation')
  .action(smartCommand);

program
  .command('list')
  .description('List all configured triggers')
  .action(listCommand);

program
  .command('remove <id>')
  .description('Remove a trigger by ID (e.g., 001)')
  .action(removeCommand);

program
  .command('install')
  .description('Register all triggers with your OS scheduler (cron/launchd/schtasks)')
  .action(installCommand);

program
  .command('uninstall')
  .description('Remove all claude-shift tasks from your OS scheduler')
  .action(uninstallCommand);

program
  .command('status')
  .description('Show scheduler status, installed tasks, and recent ping logs')
  .action(statusCommand);

program
  .command('ping')
  .description('Execute a ping right now (for testing)')
  .action(pingCommand);

program
  .command('today')
  .description('Show today\'s visual timeline of pings, slots, and work windows')
  .action(todayCommand);

program
  .command('week')
  .description('Show the full week visual timeline')
  .action(weekCommand);

const configCmd = program
  .command('config')
  .description('View or modify settings (slotDuration, burnRate, claudePath, nodePath, pingPath, pingMessage, retryEnabled, retryIntervals)');

configCmd
  .command('get [key]')
  .description('Show one setting, or all settings if no key given')
  .action(configGetCommand);

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value')
  .option('--verify', 'Run a validation ping after setting pingPath')
  .action(configSetCommand);

program
  .command('enable <id>')
  .description('Enable a trigger by ID')
  .action(enableCommand);

program
  .command('disable <id>')
  .description('Disable a trigger by ID')
  .action(disableCommand);

program.parse();
