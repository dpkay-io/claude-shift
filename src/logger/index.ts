import fs from 'node:fs';
import { CONFIG_DIR, LOG_FILE } from '../config/defaults.js';

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

function formatLocalTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function logPing(triggerId: string, status: 'success' | 'error', detail?: string, response?: string): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const filePath = LOG_FILE;
  rotateIfNeeded(filePath);
  const localTime = formatLocalTime(new Date());
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
