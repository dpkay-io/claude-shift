import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/manager.js';
import { createScheduler } from '../scheduler/factory.js';
import { isClaudeInstalled, findClaude } from '../utils/claude-check.js';
import * as display from '../utils/display.js';

export async function installCommand(): Promise<void> {
  const config = loadConfig();
  const enabled = config.triggers.filter(t => t.enabled);

  if (enabled.length === 0) {
    display.warn('No triggers configured. Use `claude-shift add` or `claude-shift smart` first.');
    return;
  }

  if (!isClaudeInstalled()) {
    display.error('Claude CLI not found. Install it first: https://claude.ai/download');
    process.exitCode = 1;
    return;
  }

  const scheduler = createScheduler();
  const check = await scheduler.check();
  if (!check.available) {
    display.error(`Scheduler not available: ${check.reason}`);
    process.exitCode = 1;
    return;
  }

  // Resolve the ping-runner script path
  const thisFile = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(thisFile), '..', '..');
  const pingScript = path.join(projectRoot, 'scripts', 'ping-runner.js');
  if (!fs.existsSync(pingScript)) {
    display.error(`Ping runner script not found at: ${pingScript}`);
    process.exitCode = 1;
    return;
  }
  const nodePath = config.settings.nodePath;

  if (!fs.existsSync(nodePath)) {
    display.error(`Node.js not found at: ${nodePath}`);
    display.info('Fix with: claude-shift config set nodePath /path/to/node');
    process.exitCode = 1;
    return;
  }

  if (!path.isAbsolute(config.settings.claudePath)) {
    const resolved = findClaude();
    if (resolved) {
      display.info(`Tip: claudePath is '${config.settings.claudePath}'. Using absolute path '${resolved}' is more reliable for scheduled tasks.`);
    }
  }

  let installed = 0;
  let failed = 0;

  for (const trigger of enabled) {
    const command = `"${nodePath}" "${pingScript}" "${trigger.id}"`;
    try {
      await scheduler.install({ id: trigger.id, command, time: trigger.time, days: trigger.days });
      display.success(`${trigger.id}: ${trigger.time} on ${trigger.days.join(',')}`);
      installed++;
    } catch (err) {
      display.error(`${trigger.id}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log();
  if (failed === 0) {
    display.success(`All ${installed} trigger(s) installed with ${scheduler.name}.`);
  } else {
    display.warn(`${installed} installed, ${failed} failed.`);
  }
}
