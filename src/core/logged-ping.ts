import { logPing } from '../logger/index.js';
import { executePing, pingLogEntry, type PingResult } from './ping.js';

/** A ping that is also written to ping.log, for the CLI. (The scheduled runner logs through its own namespace-aware logger.) */
export async function executeLoggedPing(claudePath: string, message: string, triggerId: string, cwd?: string): Promise<PingResult> {
  const result = await executePing(claudePath, message, cwd);
  const { status, detail, response } = pingLogEntry(result);
  logPing(triggerId, status, detail, response);
  return result;
}
