// Claude's "Do you trust this folder?" dialog. Both the CLI ping (core/ping.ts) and the scheduled
// runner (scripts/ping-runner.js) answer it, so the detection and key choice live here only.

export const TRUST_RE = /trust\s*this\s*folder/i;

const KEY_ENTER = '\r';
const KEY_DOWN_ENTER = '\x1b[B\r';

// Claude draws the selected option with "❯" in most terminals but with a plain ASCII ">" on Windows.
// A ">" that is part of an arrow ("->", "=>") or a longer run (">>") is not a selection marker.
const SELECTION_MARKER = '(?<![-=>])[❯>]';
const SELECTED_OPTION_RE = new RegExp(`${SELECTION_MARKER}\\s*(?:\\d+\\.\\s*)?(yes|no)\\b`, 'gi');

// Recent Claude versions default to "No, exit", so a bare Enter would quit (exit code 1) — move to
// the other option first in that case. Takes ANSI-stripped output; the last highlight wins because
// the dialog may be redrawn.
export function trustDialogKeys(cleanOutput: string): string {
  const marks = [...cleanOutput.matchAll(SELECTED_OPTION_RE)];
  const last = marks[marks.length - 1];
  return last && last[1].toLowerCase() === 'no' ? KEY_DOWN_ENTER : KEY_ENTER;
}
