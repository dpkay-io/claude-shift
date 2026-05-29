import readline from 'node:readline/promises';
import { loadConfig, saveConfig, addTrigger, clearSmartTriggers, getSmartConfigs } from '../config/manager.js';
import { parseDays, parseTime, parseSlots, formatTime12h, formatDays } from '../core/time-utils.js';
import { calculatePings, explainPing } from '../core/smart-calculator.js';
import type { DayOfWeek, WorkWindow } from '../config/schema.js';
import * as display from '../utils/display.js';
import { toErrorMessage } from '../utils/text.js';
import chalk from 'chalk';

export async function smartCommand(options: { slots: string; days?: string; burnRate?: string; yes?: boolean }): Promise<void> {
  let windows: WorkWindow[];
  let days: DayOfWeek[];
  try {
    windows = parseSlots(options.slots);
    days = options.days ? parseDays(options.days) : parseDays('weekdays');
  } catch (e) {
    display.error(toErrorMessage(e));
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const parsed = options.burnRate ? parseFloat(options.burnRate) : NaN;
  if (options.burnRate && (isNaN(parsed) || parsed <= 0 || !isFinite(parsed))) {
    display.error('Burn rate must be a positive number.');
    process.exitCode = 1;
    return;
  }
  const burnRate = isNaN(parsed) ? config.settings.burnRate : parsed;

  const pings = calculatePings(windows, days, config.settings.slotDuration, burnRate);

  console.log();
  console.log(chalk.bold('Smart mode calculation:'));
  console.log(chalk.dim(`  Slot duration: ${config.settings.slotDuration}h | Burn rate: ${burnRate}h`));
  console.log();

  console.log(chalk.bold('  Your work windows:'));
  for (const w of windows) {
    console.log(`    ${formatTime12h(parseTime(w.start))} – ${formatTime12h(parseTime(w.end))} on ${formatDays(days)}`);
  }
  console.log();

  console.log(chalk.bold('  Calculated pings:'));
  for (const ping of pings) {
    console.log(`    ${chalk.cyan(explainPing(ping, config.settings.slotDuration))}`);
  }
  console.log();

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      display.error('Non-interactive mode requires --yes to apply triggers.');
      process.exitCode = 1;
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('  Apply these triggers? (y/n) ');
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log(chalk.dim('  Cancelled.'));
      return;
    }
  }

  const removed = clearSmartTriggers(config, days);
  if (removed > 0) {
    display.info(`Replaced ${removed} previous smart trigger(s).`);
  }

  const smartConfigs = getSmartConfigs(config).filter(s => !s.days.some(d => days.includes(d)));
  smartConfigs.push({ windows, days, burnRate });
  config.smart = smartConfigs;

  for (const ping of pings) {
    addTrigger(config, {
      time: ping.time,
      days: ping.days,
      source: 'smart',
      enabled: true,
      smartMeta: {
        targetSlotStart: ping.targetSlotStart,
        targetSlotEnd: ping.targetSlotEnd,
      },
    });
  }

  saveConfig(config);

  display.success(`${pings.length} smart trigger(s) configured.`);
  display.info('Run `claude-shift install` to activate with your OS scheduler.');
}
