import chalk from 'chalk';
import type { Trigger } from '../config/schema.js';
import { formatTime12h, formatDays, parseTime } from '../core/time-utils.js';

export function printTriggerTable(triggers: Trigger[]): void {
  if (triggers.length === 0) {
    console.log(chalk.dim('  No triggers configured.'));
    return;
  }

  const header = `  ${'ID'.padEnd(12)} ${'Time'.padEnd(8)} ${'Days'.padEnd(20)} ${'Source'.padEnd(8)} ${'Status'.padEnd(8)} Target`;
  console.log(chalk.bold(header));
  console.log(chalk.dim('  ' + '─'.repeat(76)));

  for (const t of triggers) {
    const time = formatTime12h(parseTime(t.time));
    const days = formatDays(t.days);
    const status = t.enabled ? chalk.green('active') : chalk.dim('off');
    const target = t.smartMeta
      ? `${formatTime12h(parseTime(t.smartMeta.targetSlotStart))}–${formatTime12h(parseTime(t.smartMeta.targetSlotEnd))}`
      : chalk.dim('—');
    console.log(`  ${chalk.cyan(t.id.padEnd(12))} ${time.padEnd(8)} ${days.padEnd(20)} ${t.source.padEnd(8)} ${status.padEnd(8)} ${target}`);
  }
}

export function success(msg: string): void {
  console.log(chalk.green('✓') + ' ' + msg);
}

export function warn(msg: string): void {
  console.log(chalk.yellow('⚠') + ' ' + msg);
}

export function error(msg: string): void {
  console.log(chalk.red('✗') + ' ' + msg);
}

export function info(msg: string): void {
  console.log(chalk.blue('ℹ') + ' ' + msg);
}
