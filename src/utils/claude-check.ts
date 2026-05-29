import { execFileSync } from 'node:child_process';
import { detectPlatform } from './platform.js';

export function resolveExePath(name: string): string {
  const cmd = detectPlatform() === 'windows' ? 'where' : 'which';
  try {
    const result = execFileSync(cmd, [name], { encoding: 'utf-8', timeout: 5000 });
    const paths = result.trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (detectPlatform() === 'windows') {
      const exe = paths.find(p => p.toLowerCase().endsWith('.exe'));
      if (exe) return exe;
    }
    return paths[0] ?? name;
  } catch {}
  return name;
}

export function findClaude(): string | null {
  const resolved = resolveExePath('claude');
  return resolved === 'claude' ? null : resolved;
}

export function isClaudeInstalled(): boolean {
  return findClaude() !== null;
}
