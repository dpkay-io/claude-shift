import os from 'node:os';
import path from 'node:path';
import type { Config, Settings } from './schema.js';

export const CONFIG_DIR = path.join(os.homedir(), '.claude-shift');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const LOG_FILE = path.join(CONFIG_DIR, 'ping.log');

export function defaultSettings(): Settings {
  return {
    slotDuration: 5,
    burnRate: 2,
    claudePath: 'claude',
    nodePath: process.execPath,
    logFile: LOG_FILE,
    pingMessage: 'ping',
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
