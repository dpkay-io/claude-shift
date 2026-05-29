import path from 'node:path';
import { logPing } from '../logger/index.js';
import { resolveExePath } from '../utils/claude-check.js';

export interface PingResult {
  success: boolean;
  duration: number;
  error?: string;
  response?: string;
}

const SHELL_META = /[;&|`${}[\]!#~<>*?\n\r]/;
const ANSI_RE = /\x1B(?:\[[0-9;]*[a-zA-Z]|\][^\x07]*\x07|\(B)/g;

function extractResponse(rawOutput: string, message: string): string {
  let cleaned = rawOutput.replace(ANSI_RE, '');
  const msgIdx = cleaned.indexOf(message);
  if (msgIdx !== -1) cleaned = cleaned.slice(msgIdx + message.length);
  cleaned = cleaned.replace(/\/exit/g, '').replace(/[>❯]\s*/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 500);
}

function validatePath(p: string): void {
  if (!p || SHELL_META.test(p)) {
    throw new Error(`Invalid executable path: "${p}"`);
  }
}

export async function executePing(claudePath: string, message: string, triggerId: string = 'manual'): Promise<PingResult> {
  validatePath(claudePath);
  const resolved = path.isAbsolute(claudePath) ? claudePath : resolveExePath(claudePath);
  const start = Date.now();
  try {
    const pty = await import('@lydell/node-pty');

    return new Promise<PingResult>((resolve) => {
      let done = false;
      function finish(result: PingResult): void {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(result);
      }

      const proc = pty.spawn(resolved, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      });

      let output = '';
      let responseOutput = '';
      let sentMessage = false;
      let sentExit = false;
      const timeout = setTimeout(() => {
        try { proc.kill(); } catch {}
        const duration = Date.now() - start;
        const resp = responseOutput ? extractResponse(responseOutput, message) : undefined;
        logPing(triggerId, 'success', `timeout after ${duration}ms — session was started`, resp);
        finish({ success: true, duration, response: resp });
      }, 30000);

      proc.onData((data: string) => {
        if (output.length > 1_000_000) return;
        output += data;
        if (sentMessage) responseOutput += data;
        const clean = output.replace(ANSI_RE, '');
        if (!sentMessage && (clean.endsWith('> ') || clean.endsWith('>') || clean.endsWith('❯ ') || clean.includes('\n> '))) {
          sentMessage = true;
          setTimeout(() => {
            if (done) return;
            proc.write(message + '\r');
          }, 1000);
        }
        if (sentMessage && !sentExit && responseOutput.length > 50) {
          sentExit = true;
          setTimeout(() => {
            if (done) return;
            proc.write('/exit\r');
          }, 2000);
        }
      });

      proc.onExit(({ exitCode }) => {
        const duration = Date.now() - start;
        const ok = exitCode === 0 || exitCode === null;
        const resp = responseOutput ? extractResponse(responseOutput, message) : undefined;
        logPing(triggerId, ok ? 'success' : 'error', `exit=${exitCode} duration=${duration}ms`, resp);
        finish({ success: ok, duration, error: ok ? undefined : `process exited with code ${exitCode}`, response: resp });
      });
    });
  } catch (err) {
    const duration = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    logPing(triggerId, 'error', errMsg);
    return { success: false, duration, error: errMsg };
  }
}
