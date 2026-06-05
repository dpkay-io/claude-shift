import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig } from '../config/manager.js';
import type { Settings } from '../config/schema.js';
import { executePing } from '../core/ping.js';
import * as display from '../utils/display.js';
import chalk from 'chalk';

const SETTABLE_KEYS: (keyof Settings)[] = [
  'slotDuration',
  'burnRate',
  'claudePath',
  'nodePath',
  'pingPath',
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
  if (key === 'pingPath') {
    const resolved = path.resolve(value);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return { error: `pingPath must be an existing directory. "${value}" not found.` };
    }
    return { parsed: resolved };
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

export async function configSetCommand(key: string, value: string, options?: { verify?: boolean }): Promise<void> {
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
  display.success(`${key} = ${result.parsed}`);

  if (key === 'pingPath' && options?.verify) {
    display.info('Running validation ping from the new path...');
    const pingResult = await executePing(
      config.settings.claudePath,
      config.settings.pingMessage,
      'validation',
      result.parsed as string,
    );
    if (pingResult.success) {
      display.success('Validation ping succeeded — path is good.');
    } else {
      display.warn(`Validation ping failed: ${pingResult.error}`);
      display.info('The path was saved, but pings may fail at runtime. Verify claudePath and pingPath are correct.');
    }
  } else if (key === 'pingPath') {
    display.info('Run `claude-shift ping` to verify the path works.');
  }
}
