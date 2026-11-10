import fs from 'node:fs';
import { CONFIG_DIR, LOG_FILE } from '../config/defaults.js';
import { formatLocalDateTime } from '../core/time-utils.js';

const MAX_LOG_SIZE = 1024 * 1024; // 1MB
const KEEP_LINES = 500;

function rotateIfNeeded(filePath: string): void {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_LOG_SIZE) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const trimmed = lines.slice(-KEEP_LINES).join('\n');
      fs.writeFileSync(filePath, trimmed, 'utf-8');
    }
  } catch {
    // file doesn't exist yet
  }
}

function sanitize(s: string): string {
  return s.replace(/[\n\r]/g, ' ').replace(/"/g, "'");
}

export function logPing(triggerId: string, status: string, detail?: string, response?: string): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const filePath = LOG_FILE;
  rotateIfNeeded(filePath);
  const localTime = formatLocalDateTime(new Date());
  const extra = detail ? ` detail="${sanitize(detail).slice(0, 500)}"` : '';
  const resp = response ? ` response="${sanitize(response).slice(0, 500)}"` : '';
  const line = `[${localTime}] PING trigger=${sanitize(triggerId)} status=${status}${extra}${resp}\n`;
  fs.appendFileSync(filePath, line, 'utf-8');
}

export function readRecentLogs(count: number = 20): string[] {
  const filePath = LOG_FILE;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.slice(-count);
  } catch {
    return [];
  }
}
