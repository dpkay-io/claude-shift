import path from 'node:path';
import { logPing } from '../logger/index.js';
import { resolveExePath } from '../utils/claude-check.js';

export interface PingResult {
  success: boolean;
  duration: number;
  error?: string;
}

const SHELL_META = /[;&|`$(){}[\]!#~<>*?\n\r]/;

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
      const proc = pty.spawn(resolved, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      });

      let output = '';
      let sentMessage = false;
      let sentExit = false;
      const timeout = setTimeout(() => {
        try { proc.kill(); } catch {}
        const duration = Date.now() - start;
        logPing(triggerId, 'success', `timeout after ${duration}ms — session was started`);
        resolve({ success: true, duration });
      }, 30000);

      proc.onData((data: string) => {
        output += data;
        if (output.length > 1_000_000) return;
        if (!sentMessage && (output.includes('>') || output.includes('Claude'))) {
          sentMessage = true;
          setTimeout(() => {
            proc.write(message + '\r');
          }, 1000);
        }
        if (sentMessage && !sentExit && output.length > message.length + 200) {
          sentExit = true;
          setTimeout(() => {
            proc.write('/exit\r');
          }, 2000);
        }
      });

      proc.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        const duration = Date.now() - start;
        const ok = exitCode === 0 || exitCode === null;
        logPing(triggerId, ok ? 'success' : 'error', `exit=${exitCode} duration=${duration}ms`);
        resolve({ success: ok, duration, error: ok ? undefined : `process exited with code ${exitCode}` });
      });
    });
  } catch (err) {
    const duration = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    logPing(triggerId, 'error', errMsg);
    return { success: false, duration, error: errMsg };
  }
}
