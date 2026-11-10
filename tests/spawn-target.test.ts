import { describe, expect, it } from 'vitest';
import { claudeSpawnTarget } from '../src/utils/spawn-target.js';

const COM_SPEC = 'C:\\Windows\\System32\\cmd.exe';
const WINDOWS = { platform: 'win32', comSpec: COM_SPEC } as const;
const LEAN_ARGS = ['-p', '--tools', '', '--system-prompt', 'Answer as briefly as possible.'];

describe('claudeSpawnTarget', () => {
  it('runs a Windows .cmd/.bat through cmd.exe as one verbatim, fully quoted command line', () => {
    const file = 'C:\\Users\\a b\\npm\\claude.cmd';
    expect(claudeSpawnTarget(file, LEAN_ARGS, WINDOWS)).toEqual({
      file: COM_SPEC,
      // /s makes cmd strip only the outermost quotes, so the quoted path and the empty "" argument survive.
      args: ['/d', '/s', '/c', '""C:\\Users\\a b\\npm\\claude.cmd" "-p" "--tools" "" "--system-prompt" "Answer as briefly as possible.""'],
      windowsVerbatimArguments: true,
    });
    expect(claudeSpawnTarget('C:\\x\\CLAUDE.BAT', [], WINDOWS).args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
  });

  it('falls back to cmd.exe when ComSpec is not set', () => {
    expect(claudeSpawnTarget('C:\\x\\claude.cmd', [], { platform: 'win32', comSpec: undefined }).file).toBe('cmd.exe');
  });

  it('refuses an argument that contains a double quote, which cannot be quoted safely for cmd.exe', () => {
    expect(() => claudeSpawnTarget('C:\\x\\claude.cmd', ['say "hi"'], WINDOWS)).toThrow(/double quote/i);
  });

  it('launches a Windows .exe directly with its arguments untouched', () => {
    expect(claudeSpawnTarget('C:\\Users\\dpk\\.local\\bin\\claude.exe', LEAN_ARGS, WINDOWS)).toEqual({
      file: 'C:\\Users\\dpk\\.local\\bin\\claude.exe',
      args: LEAN_ARGS,
    });
  });

  it('never wraps anything on other platforms, even a file named .cmd', () => {
    expect(claudeSpawnTarget('/usr/local/bin/claude', LEAN_ARGS, { platform: 'darwin', comSpec: COM_SPEC })).toEqual({ file: '/usr/local/bin/claude', args: LEAN_ARGS });
    expect(claudeSpawnTarget('/tmp/x.cmd', ['-p'], { platform: 'linux', comSpec: COM_SPEC })).toEqual({ file: '/tmp/x.cmd', args: ['-p'] });
  });
});
