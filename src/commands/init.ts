import readline from 'node:readline/promises';
import { loadConfig, saveConfig, addTrigger } from '../config/manager.js';
import { findClaude } from '../utils/claude-check.js';
import { parseDays, parseTime } from '../core/time-utils.js';
import { smartCommand } from './smart.js';
import { installCommand } from './install.js';
import * as display from '../utils/display.js';
import { toErrorMessage } from '../utils/text.js';
import chalk from 'chalk';

async function ask(rl: readline.Interface, question: string, fallback?: string): Promise<string> {
  const suffix = fallback ? chalk.dim(` (${fallback})`) : '';
  const answer = await rl.question(`  ${question}${suffix}: `);
  return answer.trim() || fallback || '';
}

export async function initCommand(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error('Error: init requires an interactive terminal.');
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log();
    console.log(chalk.bold('claude-shift setup'));
    console.log(chalk.dim('Optimize your Claude Max 5-hour slots'));
    console.log();

    const config = loadConfig();

    // Detect claude
    const claudePath = findClaude();
    if (claudePath) {
      display.success(`Found Claude CLI at: ${claudePath}`);
      config.settings.claudePath = claudePath;
    } else {
      display.warn('Claude CLI not found in PATH.');
      const manual = await ask(rl, 'Path to claude CLI');
      if (manual) config.settings.claudePath = manual;
    }

    // Slot duration
    const slotStr = await ask(rl, 'Slot duration in hours', String(config.settings.slotDuration));
    const slotVal = parseFloat(slotStr);
    config.settings.slotDuration = isNaN(slotVal) || slotVal <= 0 || !isFinite(slotVal) ? 5 : slotVal;

    // Burn rate
    const burnStr = await ask(rl, 'Your typical slot burn rate in hours', String(config.settings.burnRate));
    const burnVal = parseFloat(burnStr);
    config.settings.burnRate = isNaN(burnVal) || burnVal <= 0 || !isFinite(burnVal) ? 2 : burnVal;

    saveConfig(config);

    // Mode selection
    console.log();
    console.log(chalk.bold('How would you like to configure triggers?'));
    console.log('  1. Smart mode — tell me your work hours, I\'ll calculate the pings');
    console.log('  2. Manual mode — specify exact ping times');
    console.log();
    const mode = await ask(rl, 'Choose (1 or 2)', '1');

    if (mode === '1') {
      console.log();
      console.log(chalk.dim('  Enter your work windows as HH:mm-HH:mm, comma-separated.'));
      console.log(chalk.dim('  Example: 06:30-08:00,09:00-11:00,20:00-23:00'));
      console.log();
      const slots = await ask(rl, 'Work windows');
      const days = await ask(rl, 'Days', 'weekdays');
      rl.close();

      if (slots) {
        await smartCommand({ slots, days, yes: true });
      }
    } else {
      console.log();
      console.log(chalk.dim('  Enter ping times one at a time. Empty to finish.'));
      console.log();
      let count = 0;
      while (true) {
        const time = await ask(rl, 'Ping time (HH:mm, or empty to finish)');
        if (!time) break;
        const daysInput = await ask(rl, 'Days', 'weekdays');
        try {
          const days = parseDays(daysInput);
          parseTime(time);
          addTrigger(config, { time, days, source: 'manual', enabled: true });
          count++;
          display.success(`Added trigger at ${time}`);
        } catch (e) {
          display.error(toErrorMessage(e));
        }
      }
      rl.close();
      if (count > 0) {
        saveConfig(config);
      }
    }

    // Show configured triggers
    const finalConfig = loadConfig();
    if (finalConfig.triggers.length > 0) {
      console.log();
      console.log(chalk.bold('Configured triggers:'));
      console.log();
      display.printTriggerTable(finalConfig.triggers);
    }

    // Offer to install
    let rl2: readline.Interface | undefined;
    try {
      rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log();
      const doInstall = await ask(rl2, 'Install to OS scheduler now? (y/n)', 'y');

      if (doInstall.toLowerCase() === 'y') {
        await installCommand();
      } else {
        display.info('Run `claude-shift install` when ready.');
      }
    } finally {
      rl2?.close();
    }
  } catch (err) {
    rl.close();
    if (err instanceof Error) display.error(err.message);
    process.exitCode = 1;
  }
}
