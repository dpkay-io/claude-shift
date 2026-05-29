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

function parseSetting(key: keyof Settings, value: string): { parsed: unknown } | { error: string } {
  if (BOOLEAN_KEYS.includes(key)) {
    if (value !== 'true' && value !== 'false') return { error: `${key} must be true or false.` };
    return { parsed: value === 'true' };
  }
  if (ARRAY_NUMERIC_KEYS.includes(key)) {
    const nums = value.split(',').map(s => parseInt(s.trim(), 10));
    if (nums.some(n => isNaN(n) || n <= 0)) return { error: `${key} must be comma-separated positive integers (e.g., 5,15,30,45,60).` };
    return { parsed: nums.sort((a, b) => a - b) };
  }
  if (NUMERIC_KEYS.includes(key)) {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return { error: `${key} must be a positive number.` };
    return { parsed: num };
  }
  return { parsed: value };
}

function isSettableKey(key: string): key is keyof Settings {
  return SETTABLE_KEYS.includes(key as keyof Settings);
}

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

  if (!isSettableKey(key)) {
    display.error(`Unknown setting: ${key}`);
    console.log(`  Available: ${SETTABLE_KEYS.join(', ')}`);
    return;
  }

  console.log(`${key}: ${config.settings[key]}`);
}

export function configSetCommand(key: string, value: string): void {
  if (!isSettableKey(key)) {
    display.error(`Unknown setting: ${key}`);
    console.log(`  Available: ${SETTABLE_KEYS.join(', ')}`);
    return;
  }

  const config = loadConfig();
  const result = parseSetting(key, value);
  if ('error' in result) {
    display.error(result.error);
    return;
  }

  (config.settings as unknown as Record<string, unknown>)[key] = result.parsed;
  saveConfig(config);
  display.success(`${key} = ${value}`);
}
