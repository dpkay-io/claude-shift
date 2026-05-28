import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../config/defaults.js';

const MAX_LOG_SIZE = 1024 * 1024; // 1MB
const KEEP_LINES = 500;

function logPath(): string {
  return path.join(CONFIG_DIR, 'ping.log');
}

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
  return s.replace(/[\n\r]/g, ' ');
}

export function logPing(triggerId: string, status: 'success' | 'error', detail?: string): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const filePath = logPath();
  rotateIfNeeded(filePath);
  const ts = new Date().toISOString();
  const extra = detail ? ` detail="${sanitize(detail)}"` : '';
  const line = `[${ts}] PING trigger=${sanitize(triggerId)} status=${status}${extra}\n`;
  fs.appendFileSync(filePath, line, 'utf-8');
}

export function readRecentLogs(count: number = 20): string[] {
  const filePath = logPath();
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.slice(-count);
  } catch {
    return [];
  }
}
