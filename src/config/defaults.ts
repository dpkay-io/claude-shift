import path from 'node:path';
import type { Config, Settings } from './schema.js';
import { configDir } from './namespace.js';

export const CONFIG_DIR = configDir();
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const LOG_FILE = path.join(CONFIG_DIR, 'ping.log');

export function defaultSettings(): Settings {
  return {
    slotDuration: 5,
    burnRate: 2,
    claudePath: 'claude',
    nodePath: process.execPath,
    pingPath: '',
    pingMessage: 'ping',
    retryEnabled: true,
    retryIntervals: [5, 15, 30, 45, 60],
  };
}

export function defaultConfig(): Config {
  return {
    version: 1,
    triggers: [],
    nextId: 1,
    settings: defaultSettings(),
  };
}
