import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/manager.js';
import { createScheduler } from '../scheduler/factory.js';
import { isClaudeInstalled, findClaude } from '../utils/claude-check.js';
import { formatTime12h, formatDays, formatDateShort, parseTime } from '../core/time-utils.js';
import * as display from '../utils/display.js';
import { SHELL_META, toErrorMessage } from '../utils/text.js';

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

  if (SHELL_META.test(nodePath)) {
    display.error(`Node path contains unsafe characters: "${nodePath}"`);
    display.info('Fix with: claude-shift config set nodePath /path/to/node');
    process.exitCode = 1;
    return;
  }

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

  if (!config.settings.pingPath) {
    display.warn('pingPath is not set — scheduled pings will run from the home directory.');
    display.info('Set it with: claude-shift config set pingPath /path/to/project');
  }

  const enabledIds = new Set(enabled.map(t => t.id));
  const existing = await scheduler.list();
  let orphansRemoved = 0;
  for (const task of existing) {
    if (!enabledIds.has(task.id)) {
      try {
        await scheduler.remove(task.id);
        display.info(`Removed orphaned task: ${task.id}`);
        orphansRemoved++;
      } catch {}
    }
  }

  let installed = 0;
  let failed = 0;

  for (const trigger of enabled) {
    const command = `"${nodePath}" "${pingScript}" "${trigger.id}"`;
    try {
      await scheduler.install({ id: trigger.id, command, time: trigger.time, days: trigger.days, ...(trigger.date ? { date: trigger.date } : {}) });
      const timeLabel = formatTime12h(parseTime(trigger.time));
      const schedule = trigger.date ? `${timeLabel} on ${formatDateShort(trigger.date)} (once)` : `${timeLabel} on ${formatDays(trigger.days)}`;
      display.success(`${trigger.id}: ${schedule}`);
      installed++;
    } catch (err) {
      display.error(`${trigger.id}: ${toErrorMessage(err)}`);
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
