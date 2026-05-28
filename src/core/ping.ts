import { logPing } from '../logger/index.js';

export interface PingResult {
  success: boolean;
  duration: number;
  error?: string;
}

export async function executePing(claudePath: string, message: string, triggerId: string = 'manual'): Promise<PingResult> {
  const start = Date.now();
  try {
    const pty = await import('@lydell/node-pty');

    return new Promise<PingResult>((resolve) => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const args = process.platform === 'win32'
        ? ['/c', claudePath]
        : ['-c', claudePath];

      const proc = pty.spawn(shell, args, {
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
        // Wait for claude to be ready (shows prompt), then send message
        if (!sentMessage && (output.includes('>') || output.includes('Claude'))) {
          setTimeout(() => {
            proc.write(message + '\r');
            sentMessage = true;
          }, 1000);
        }
        // After sending message, wait for response then exit
        if (sentMessage && !sentExit && output.length > message.length + 200) {
          setTimeout(() => {
            proc.write('/exit\r');
            sentExit = true;
          }, 2000);
        }
      });

      proc.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        const duration = Date.now() - start;
        logPing(triggerId, 'success', `exit=${exitCode} duration=${duration}ms`);
        resolve({ success: true, duration });
      });
    });
  } catch (err) {
    const duration = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    logPing(triggerId, 'error', errMsg);
    return { success: false, duration, error: errMsg };
  }
}
