import readline from 'node:readline/promises';
import { loadConfig, saveConfig, addTrigger, clearSmartTriggers, getSmartConfigs } from '../config/manager.js';
import { parseDays, parseTime, parseSlots, formatTime12h, formatDays } from '../core/time-utils.js';
import { calculatePings, explainPing } from '../core/smart-calculator.js';
import { createScheduler } from '../scheduler/factory.js';
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

  if (burnRate >= config.settings.slotDuration) {
    display.warn(`Burn rate (${burnRate}h) is >= slot duration (${config.settings.slotDuration}h). Pings will fire at window start with no pre-burn buffer.`);
  }

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
    if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
      console.log(chalk.dim('  Cancelled.'));
      return;
    }
  }

  // Remove from scheduler first, then from config — prevents orphaned OS tasks
  const smartToRemove = config.triggers.filter(t => t.source === 'smart' && t.days.some(d => days.includes(d)));
  if (smartToRemove.length > 0) {
    const scheduler = createScheduler();
    const failedRemovals: string[] = [];
    for (const t of smartToRemove) {
      try { await scheduler.remove(t.id); } catch { failedRemovals.push(t.id); }
    }
    clearSmartTriggers(config, days);
    if (failedRemovals.length > 0) {
      display.warn(`Could not remove ${failedRemovals.length} task(s) from scheduler: ${failedRemovals.join(', ')}. Run \`claude-shift uninstall\` to clean up.`);
    }
    display.info(`Replaced ${smartToRemove.length} previous smart trigger(s).`);
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

  if (options.yes) {
    display.info('Run `claude-shift install` to activate with your OS scheduler.');
    return;
  }
  if (!process.stdin.isTTY) {
    display.info('Run `claude-shift install` to activate with your OS scheduler.');
    return;
  }
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const installAnswer = await rl2.question('  Install to OS scheduler now? (y/n) ');
  rl2.close();
  if (['y', 'yes'].includes(installAnswer.trim().toLowerCase())) {
    const { installCommand } = await import('./install.js');
    await installCommand();
  } else {
    display.info('Run `claude-shift install` when ready.');
  }
}
