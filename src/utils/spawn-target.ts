const WINDOWS_SCRIPT_RE = /\.(cmd|bat)$/i;
const WINDOWS_SHELL_FALLBACK = 'cmd.exe';
// /d skips AutoRun commands, /s makes cmd strip only the outermost pair of quotes, /c runs the line.
const CMD_FLAGS = ['/d', '/s', '/c'];

export interface SpawnHost {
  platform: NodeJS.Platform;
  /** Value of the ComSpec environment variable, if set. */
  comSpec: string | undefined;
}

export interface SpawnTarget {
  file: string;
  args: string[];
  /** Hand `args` to the process exactly as given (Windows only), because they are already a cmd.exe command line. */
  windowsVerbatimArguments?: boolean;
}

// Read at call time, not import time, so tests and long-lived processes see the real environment.
const currentHost = (): SpawnHost => ({ platform: process.platform, comSpec: process.env.ComSpec });

function quoteForCmd(arg: string): string {
  // Nothing can escape a double quote inside a quoted cmd.exe argument. Every argument here is a
  // fixed flag or a path (paths cannot contain one on Windows), so refuse rather than guess.
  if (arg.includes('"')) throw new Error(`Cannot pass an argument containing a double quote through cmd.exe: ${arg}`);
  return `"${arg}"`;
}

/**
 * What to hand to child_process.spawn to run `file` with `args`. Node refuses to launch .cmd/.bat
 * (e.g. npm's claude.cmd) directly, so on Windows those run through cmd.exe, by its absolute
 * ComSpec path (under Task Scheduler a bare "cmd.exe" can fail to resolve even though Path has
 * System32). cmd.exe re-parses its command line and mangles it once it holds more than two quotes,
 * which breaks a script path with a space as soon as any argument is quoted. So the whole line is
 * built here, each part quoted, wrapped in one more pair of quotes for /s to strip, and passed verbatim.
 */
export function claudeSpawnTarget(file: string, args: string[], host: SpawnHost = currentHost()): SpawnTarget {
  if (host.platform === 'win32' && WINDOWS_SCRIPT_RE.test(file)) {
    const commandLine = [file, ...args].map(quoteForCmd).join(' ');
    return { file: host.comSpec || WINDOWS_SHELL_FALLBACK, args: [...CMD_FLAGS, `"${commandLine}"`], windowsVerbatimArguments: true };
  }
  return { file, args };
}
