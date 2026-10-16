import os from 'node:os';
import path from 'node:path';

// An optional instance name that isolates a claude-shift install: its config dir and every OS
// scheduler entry get their own names, so E2E tests (or a second install) never touch the real one.
// Read lazily so scripts/ping-runner.js can set it from its --namespace argument at startup.
export const NAMESPACE_ENV = 'CLAUDE_SHIFT_NAMESPACE';
export const NAMESPACE_ARG = '--namespace';

const BASE_NAME = 'claude-shift';
// Ends up in task names, file names, cron comments and command lines, so keep it to safe characters.
const NAMESPACE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function currentNamespace(): string {
  const ns = process.env[NAMESPACE_ENV] ?? '';
  if (ns && !NAMESPACE_RE.test(ns)) {
    throw new Error(`${NAMESPACE_ENV} may only contain lowercase letters, digits and single dashes: "${ns}"`);
  }
  return ns;
}

function instanceName(): string {
  const ns = currentNamespace();
  return ns ? `${BASE_NAME}-${ns}` : BASE_NAME;
}

export function configDir(): string {
  return path.join(os.homedir(), `.${instanceName()}`);
}

/** Windows Task Scheduler task-name prefix, e.g. "claude-shift-" or "claude-shift-e2e-". */
export function schtasksPrefix(): string {
  return `${instanceName()}-`;
}

/** launchd label prefix, e.g. "com.claude-shift." */
export function launchdLabelPrefix(): string {
  return `com.${instanceName()}.`;
}

/** crontab line tag prefix, e.g. "# claude-shift:" */
export function cronTagPrefix(): string {
  return `# ${instanceName()}:`;
}

/** Extra runner arguments so a scheduled ping keeps using the instance that scheduled it. */
export function namespaceArgs(): string {
  const ns = currentNamespace();
  return ns ? ` ${NAMESPACE_ARG} ${ns}` : '';
}
