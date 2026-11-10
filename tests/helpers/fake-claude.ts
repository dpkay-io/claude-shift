import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A stand-in for the `claude` binary so ping tests cost no usage. It records how it was launched
// (argv, cwd, stdin) and then replays a scripted stream-json run. On Windows the entry point is a
// `.cmd` shim, like npm's claude.cmd, so the cmd.exe launch path is exercised too. The folder name
// contains a space on purpose: unquoted paths are the classic way that launch path breaks.

export interface FakeClaudeSpec {
  /** Lines written to stdout (each gets a trailing newline). */
  stdout?: string[];
  stderr?: string;
  exitCode?: number;
  /** Keep running this long after replaying output, to exercise the timeout. */
  hangMs?: number;
}

export interface FakeClaudeRecord {
  argv: string[];
  cwd: string;
  stdin: string;
}

export interface FakeClaude {
  /** Absolute path to hand to claude-shift as `claudePath`. */
  command: string;
  readRecord(): FakeClaudeRecord;
  dispose(): void;
}

const FOLDER_NAME = 'fake claude dir';
const SCRIPT_NAME = 'fake-claude.mjs';
const SPEC_NAME = 'spec.json';
const RECORD_NAME = 'record.json';

const SCRIPT = `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(path.join(dir, '${SPEC_NAME}'), 'utf-8'));
let stdin = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', async () => {
  fs.writeFileSync(path.join(dir, '${RECORD_NAME}'), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), stdin }));
  for (const line of spec.stdout ?? []) process.stdout.write(line + '\\n');
  if (spec.stderr) process.stderr.write(spec.stderr);
  if (spec.hangMs) await new Promise((resolve) => setTimeout(resolve, spec.hangMs));
  process.exitCode = spec.exitCode ?? 0;
});
`;

export function createFakeClaude(spec: FakeClaudeSpec): FakeClaude {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-shift-fake-'));
  const dir = path.join(root, FOLDER_NAME);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, SCRIPT_NAME), SCRIPT);
  fs.writeFileSync(path.join(dir, SPEC_NAME), JSON.stringify(spec));

  const isWindows = process.platform === 'win32';
  const command = path.join(dir, isWindows ? 'claude.cmd' : 'claude');
  const shim = isWindows
    ? `@echo off\r\n"${process.execPath}" "%~dp0${SCRIPT_NAME}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/${SCRIPT_NAME}" "$@"\n`;
  fs.writeFileSync(command, shim, { mode: 0o755 });

  return {
    command,
    readRecord: () => JSON.parse(fs.readFileSync(path.join(dir, RECORD_NAME), 'utf-8')) as FakeClaudeRecord,
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
