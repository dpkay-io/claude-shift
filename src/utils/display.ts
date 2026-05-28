import chalk from 'chalk';
import type { Trigger } from '../config/schema.js';
import type { InstalledTask } from '../scheduler/types.js';
import { formatTime12h, formatDays, parseTime } from '../core/time-utils.js';

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;

function visibleLength(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

function pad(s: string, width: number): string {
  const diff = width - visibleLength(s);
  return diff > 0 ? s + ' '.repeat(diff) : s;
}

export function printTriggerTable(triggers: Trigger[], installedTasks?: InstalledTask[]): void {
  if (triggers.length === 0) {
    console.log(chalk.dim('  No triggers configured.'));
    return;
  }

  const installedIds = new Set(installedTasks?.map(t => t.id) ?? []);

  const header = `  ${'ID'.padEnd(12)} ${'Time'.padEnd(8)} ${'Days'.padEnd(20)} ${'Source'.padEnd(8)} ${'Status'.padEnd(14)} Target`;
  console.log(chalk.bold(header));
  console.log(chalk.dim('  ' + '─'.repeat(82)));

  for (const t of triggers) {
    const time = formatTime12h(parseTime(t.time));
    const days = formatDays(t.days);
    let status: string;
    if (!t.enabled) {
      status = chalk.dim('off');
    } else if (!installedTasks) {
      status = chalk.green('active');
    } else if (installedIds.has(t.id)) {
      status = chalk.green('active');
    } else {
      status = chalk.yellow('not installed');
    }
    const target = t.smartMeta
      ? `${formatTime12h(parseTime(t.smartMeta.targetSlotStart))}–${formatTime12h(parseTime(t.smartMeta.targetSlotEnd))}`
      : chalk.dim('—');
    console.log(`  ${pad(chalk.cyan(t.id), 12)} ${pad(time, 8)} ${pad(days, 20)} ${pad(t.source, 8)} ${pad(status, 14)} ${target}`);
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
