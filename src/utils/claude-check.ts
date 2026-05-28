import { execFileSync } from 'node:child_process';
import { detectPlatform } from './platform.js';

export function findClaude(): string | null {
  try {
    const cmd = detectPlatform() === 'windows' ? 'where' : 'which';
    const result = execFileSync(cmd, ['claude'], { encoding: 'utf-8', timeout: 5000 });
    return result.trim().split('\n')[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

export function isClaudeInstalled(): boolean {
  return findClaude() !== null;
}
