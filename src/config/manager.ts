import fs from 'node:fs';
import path from 'node:path';
import type { Config, Trigger, DayOfWeek } from './schema.js';
import { CONFIG_DIR, CONFIG_FILE, defaultConfig, defaultSettings } from './defaults.js';

function ensureDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function validateConfig(raw: unknown): Config {
  if (raw === null || typeof raw !== 'object') throw new Error('not an object');
  const obj = raw as Record<string, unknown>;

  const defaults = defaultConfig();
  const defSettings = defaultSettings();

  const version = obj.version === 1 ? 1 : defaults.version;
  const nextId = typeof obj.nextId === 'number' && obj.nextId >= 1 ? obj.nextId : defaults.nextId;
  const triggers = Array.isArray(obj.triggers) ? obj.triggers.filter(isValidTrigger) : [];
  const smart = Array.isArray(obj.smart) ? obj.smart.filter(isValidSmartConfig) : undefined;

  const rawSettings = typeof obj.settings === 'object' && obj.settings !== null
    ? obj.settings as Record<string, unknown>
    : {};
  const settings = {
    slotDuration: typeof rawSettings.slotDuration === 'number' && rawSettings.slotDuration > 0 ? rawSettings.slotDuration : defSettings.slotDuration,
    burnRate: typeof rawSettings.burnRate === 'number' && rawSettings.burnRate > 0 ? rawSettings.burnRate : defSettings.burnRate,
    claudePath: typeof rawSettings.claudePath === 'string' && rawSettings.claudePath ? rawSettings.claudePath : defSettings.claudePath,
    nodePath: typeof rawSettings.nodePath === 'string' && rawSettings.nodePath ? rawSettings.nodePath : defSettings.nodePath,
    pingMessage: typeof rawSettings.pingMessage === 'string' && rawSettings.pingMessage ? rawSettings.pingMessage : defSettings.pingMessage,
  };

  return { version, triggers, smart, nextId, settings } as Config;
}

function isValidTrigger(t: unknown): t is Trigger {
  if (t === null || typeof t !== 'object') return false;
  const obj = t as Record<string, unknown>;
  return typeof obj.id === 'string'
    && typeof obj.time === 'string'
    && Array.isArray(obj.days)
    && typeof obj.enabled === 'boolean'
    && (obj.source === 'manual' || obj.source === 'smart')
    && (obj.date === undefined || typeof obj.date === 'string');
}

function isValidSmartConfig(s: unknown): boolean {
  if (s === null || typeof s !== 'object') return false;
  const obj = s as Record<string, unknown>;
  return Array.isArray(obj.windows) && Array.isArray(obj.days) && typeof obj.burnRate === 'number' && obj.burnRate > 0;
}

export function loadConfig(): Config {
  ensureDir();
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return validateConfig(JSON.parse(raw));
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
      const config = defaultConfig();
      saveConfig(config);
      return config;
    }
    try { fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak'); } catch {}
    console.warn(`Warning: config file was corrupt or unreadable — reset to defaults. Backup saved to ${CONFIG_FILE}.bak`);
    const config = defaultConfig();
    saveConfig(config);
    return config;
  }
}

export function saveConfig(config: Config): void {
  ensureDir();
  const tmpFile = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpFile, CONFIG_FILE);
}

export function addTrigger(config: Config, trigger: Omit<Trigger, 'id'>): Trigger {
  const id = String(config.nextId).padStart(3, '0');
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
