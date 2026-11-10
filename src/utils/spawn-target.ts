const WINDOWS_SCRIPT_RE = /\.(cmd|bat)$/i;
const WINDOWS_SHELL_FALLBACK = 'cmd.exe';

export interface SpawnHost {
  platform: NodeJS.Platform;
  /** Value of the ComSpec environment variable, if set. */
  comSpec: string | undefined;
}

// Read at call time, not import time, so tests and long-lived processes see the real environment.
const currentHost = (): SpawnHost => ({ platform: process.platform, comSpec: process.env.ComSpec });

/**
 * What to hand to child_process.spawn for `file`. Node refuses to launch .cmd/.bat (e.g. npm's
 * claude.cmd) directly, so those run through cmd.exe — by its absolute ComSpec path: under Task
 * Scheduler a bare "cmd.exe" can fail to resolve even though Path has System32.
 */
export function claudeSpawnTarget(file: string, host: SpawnHost = currentHost()): { file: string; args: string[] } {
  if (host.platform === 'win32' && WINDOWS_SCRIPT_RE.test(file)) {
    return { file: host.comSpec || WINDOWS_SHELL_FALLBACK, args: ['/c', file] };
  }
  return { file, args: [] };
}
