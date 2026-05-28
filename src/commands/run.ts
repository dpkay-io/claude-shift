import { loadConfig } from '../config/manager.js';
import { executePing } from '../core/ping.js';
import * as display from '../utils/display.js';

export async function runCommand(): Promise<void> {
  const config = loadConfig();
  display.info('Sending ping to Claude...');

  const result = await executePing(
    config.settings.claudePath,
    config.settings.pingMessage,
  );

  if (result.success) {
    display.success(`Ping completed in ${(result.duration / 1000).toFixed(1)}s`);
  } else {
    display.error(`Ping failed: ${result.error}`);
    process.exitCode = 1;
  }
}
