const WINDOWS_SCRIPT_RE = /\.(cmd|bat)$/i;
const WINDOWS_SHELL_FALLBACK = 'cmd.exe';

/**
 * What to hand to child_process.spawn for `file`. Node refuses to launch .cmd/.bat (e.g. npm's
 * claude.cmd) directly, so those run through cmd.exe — by its absolute ComSpec path: under Task
 * Scheduler a bare "cmd.exe" can fail to resolve even though Path has System32.
 */
export function claudeSpawnTarget(
  file: string,
  platform: NodeJS.Platform = process.platform,
  comSpec: string | undefined = process.env.ComSpec,
): { file: string; args: string[] } {
  if (platform === 'win32' && WINDOWS_SCRIPT_RE.test(file)) {
    return { file: comSpec || WINDOWS_SHELL_FALLBACK, args: ['/c', file] };
  }
  return { file, args: [] };
}
