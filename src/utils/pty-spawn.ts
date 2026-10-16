const WINDOWS_SCRIPT_RE = /\.(cmd|bat)$/i;
const WINDOWS_SHELL_FALLBACK = 'cmd.exe';

/**
 * What to hand to pty.spawn for `file`. ConPTY can't launch .cmd/.bat (e.g. npm's claude.cmd)
 * directly, so those run through cmd.exe — by its absolute ComSpec path: under Task Scheduler
 * node-pty fails to resolve a bare "cmd.exe" ("File not found") even though Path has System32.
 */
export function ptySpawnTarget(file: string): { file: string; args: string[] } {
  if (process.platform === 'win32' && WINDOWS_SCRIPT_RE.test(file)) {
    return { file: process.env.ComSpec || WINDOWS_SHELL_FALLBACK, args: ['/c', file] };
  }
  return { file, args: [] };
}
