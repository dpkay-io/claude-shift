import { loadConfig, saveConfig } from '../config/manager.js';
import type { Settings } from '../config/schema.js';
import * as display from '../utils/display.js';
import chalk from 'chalk';

const SETTABLE_KEYS: (keyof Settings)[] = [
  'slotDuration',
  'burnRate',
  'claudePath',
  'nodePath',
  'pingMessage',
  'retryEnabled',
  'retryIntervals',
];

const NUMERIC_KEYS: (keyof Settings)[] = ['slotDuration', 'burnRate'];
const BOOLEAN_KEYS: (keyof Settings)[] = ['retryEnabled'];
const ARRAY_NUMERIC_KEYS: (keyof Settings)[] = ['retryIntervals'];

export function configGetCommand(key?: string): void {
  const config = loadConfig();

  if (!key) {
    console.log();
    console.log(chalk.bold('Current settings:'));
    for (const k of SETTABLE_KEYS) {
      console.log(`  ${chalk.cyan(k)}: ${config.settings[k]}`);
    }
    console.log();
    return;
  }

  if (!SETTABLE_KEYS.includes(key as keyof Settings)) {
    display.error(`Unknown setting: ${key}`);
    console.log(`  Available: ${SETTABLE_KEYS.join(', ')}`);
    return;
  }

  console.log(`${key}: ${config.settings[key as keyof Settings]}`);
}

export function configSetCommand(key: string, value: string): void {
  if (!SETTABLE_KEYS.includes(key as keyof Settings)) {
    display.error(`Unknown setting: ${key}`);
    console.log(`  Available: ${SETTABLE_KEYS.join(', ')}`);
    return;
  }

  const config = loadConfig();

  if (BOOLEAN_KEYS.includes(key as keyof Settings)) {
    if (value !== 'true' && value !== 'false') {
      display.error(`${key} must be true or false.`);
      return;
    }
    ((config.settings as unknown) as Record<string, unknown>)[key] = value === 'true';
  } else if (ARRAY_NUMERIC_KEYS.includes(key as keyof Settings)) {
    const nums = value.split(',').map(s => parseInt(s.trim(), 10));
    if (nums.some(n => isNaN(n) || n <= 0)) {
      display.error(`${key} must be comma-separated positive integers (e.g., 5,15,30,45,60).`);
      return;
    }
    ((config.settings as unknown) as Record<string, unknown>)[key] = nums.sort((a, b) => a - b);
  } else if (NUMERIC_KEYS.includes(key as keyof Settings)) {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) {
      display.error(`${key} must be a positive number.`);
      return;
    }
    ((config.settings as unknown) as Record<string, unknown>)[key] = num;
  } else {
    ((config.settings as unknown) as Record<string, unknown>)[key] = value;
  }

  saveConfig(config);
  display.success(`${key} = ${value}`);
}
