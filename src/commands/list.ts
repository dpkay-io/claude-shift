import { loadConfig } from '../config/manager.js';
import { printTriggerTable } from '../utils/display.js';
import chalk from 'chalk';

export function listCommand(): void {
  const config = loadConfig();
  console.log();
  console.log(chalk.bold('Configured triggers:'));
  console.log();
  printTriggerTable(config.triggers);
  console.log();
}
