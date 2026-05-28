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
  try {
    const cmd = detectPlatform() === 'windows' ? 'where' : 'which';
    const result = execFileSync(cmd, ['claude'], { encoding: 'utf-8', timeout: 5000 });
    const paths = result.trim().split('\n').map(s => s.trim()).filter(Boolean);

    if (detectPlatform() === 'windows') {
      // node-pty can only spawn real .exe files, not .cmd/.ps1/extensionless shims
      const exe = paths.find(p => p.toLowerCase().endsWith('.exe'));
      if (exe) return exe;
    }

    return paths[0] ?? null;
  } catch {
    return null;
  }
}

export function isClaudeInstalled(): boolean {
  return findClaude() !== null;
}
