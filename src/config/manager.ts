import fs from 'node:fs';
import path from 'node:path';
import type { Config, Trigger, DayOfWeek } from './schema.js';
import { CONFIG_DIR, CONFIG_FILE, defaultConfig } from './defaults.js';

function ensureDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadConfig(): Config {
  ensureDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    const config = defaultConfig();
    saveConfig(config);
    return config;
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as Config;
  } catch {
    const backup = CONFIG_FILE + '.bak';
    if (fs.existsSync(CONFIG_FILE)) {
      fs.copyFileSync(CONFIG_FILE, backup);
    }
    const config = defaultConfig();
    saveConfig(config);
    return config;
  }
}

export function saveConfig(config: Config): void {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function addTrigger(config: Config, trigger: Omit<Trigger, 'id'>): Trigger {
  const id = `shift-${String(config.nextId).padStart(3, '0')}`;
  const full: Trigger = { id, ...trigger };
  config.triggers.push(full);
  config.nextId++;
  return full;
}

export function removeTrigger(config: Config, id: string): Trigger | null {
  const idx = config.triggers.findIndex(t => t.id === id);
  if (idx === -1) return null;
  return config.triggers.splice(idx, 1)[0]!;
}

export function findTrigger(config: Config, id: string): Trigger | undefined {
  return config.triggers.find(t => t.id === id);
}

export function clearSmartTriggers(config: Config, days?: DayOfWeek[]): number {
  const before = config.triggers.length;
  config.triggers = config.triggers.filter(t => {
    if (t.source !== 'smart') return true;
    if (!days) return false;
    const hasOverlap = t.days.some(d => days.includes(d));
    return !hasOverlap;
  });
  return before - config.triggers.length;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
