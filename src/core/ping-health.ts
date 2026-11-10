// Boils the ping log down to "are pings working?", so a long run of failures cannot hide among
// the few recent lines `status` prints.

export interface PingHealth {
  /** Timestamp of the most recent successful ping, as written in the log. */
  lastSuccess?: string;
  /** Failed pings (errors and limit hits) since the last success. */
  consecutiveFailures: number;
}

// "[2026-11-09 05:00:09] PING trigger=062 [retry=4 | limit-retry] status=success ..."
const PING_RESULT_LINE_RE = /^\[([^\]]+)\] PING trigger=\S+(?: retry=\d+| limit-retry)? status=(success|error|limit-[a-z]+)(?=\s|$)/;
const SUCCESS_STATUS = 'success';

export function summarizePingHealth(logLines: string[]): PingHealth {
  let lastSuccess: string | undefined;
  let consecutiveFailures = 0;
  for (const line of logLines) {
    const match = PING_RESULT_LINE_RE.exec(line);
    if (!match) continue;
    if (match[2] === SUCCESS_STATUS) {
      lastSuccess = match[1];
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
    }
  }
  return lastSuccess ? { lastSuccess, consecutiveFailures } : { consecutiveFailures };
}
