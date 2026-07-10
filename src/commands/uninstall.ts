import readline from 'node:readline/promises';
import { createScheduler } from '../scheduler/factory.js';
import * as display from '../utils/display.js';
import { toErrorMessage } from '../utils/text.js';

export async function uninstallCommand(): Promise<void> {
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('  Remove all claude-shift tasks from the OS scheduler? (y/n) ');
    rl.close();
    if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
      console.log('  Cancelled.');
      return;
    }
  }

  const scheduler = createScheduler();

  try {
    await scheduler.removeAll();
    display.success(`All claude-shift tasks removed from ${scheduler.name}.`);
  } catch (err) {
    display.error(`Failed to remove tasks: ${toErrorMessage(err)}`);
    process.exitCode = 1;
  }
}
