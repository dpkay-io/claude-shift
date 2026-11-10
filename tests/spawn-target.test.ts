import { describe, expect, it } from 'vitest';
import { claudeSpawnTarget } from '../src/utils/spawn-target.js';

const COM_SPEC = 'C:\\Windows\\System32\\cmd.exe';

describe('claudeSpawnTarget', () => {
  it('runs a Windows .cmd or .bat through the absolute ComSpec path', () => {
    for (const file of ['C:\\Users\\a b\\npm\\claude.cmd', 'C:\\x\\CLAUDE.BAT']) {
      expect(claudeSpawnTarget(file, { platform: 'win32', comSpec: COM_SPEC })).toEqual({ file: COM_SPEC, args: ['/c', file] });
    }
  });

  it('falls back to cmd.exe when ComSpec is not set', () => {
    expect(claudeSpawnTarget('C:\\x\\claude.cmd', { platform: 'win32', comSpec: undefined })).toEqual({ file: 'cmd.exe', args: ['/c', 'C:\\x\\claude.cmd'] });
  });

  it('launches a Windows .exe directly', () => {
    expect(claudeSpawnTarget('C:\\Users\\dpk\\.local\\bin\\claude.exe', { platform: 'win32', comSpec: COM_SPEC })).toEqual({ file: 'C:\\Users\\dpk\\.local\\bin\\claude.exe', args: [] });
  });

  it('never wraps anything on other platforms, even a file named .cmd', () => {
    expect(claudeSpawnTarget('/usr/local/bin/claude', { platform: 'darwin', comSpec: COM_SPEC })).toEqual({ file: '/usr/local/bin/claude', args: [] });
    expect(claudeSpawnTarget('/tmp/x.cmd', { platform: 'linux', comSpec: COM_SPEC })).toEqual({ file: '/tmp/x.cmd', args: [] });
  });
});
