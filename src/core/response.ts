import xterm from '@xterm/headless';

export const PTY_COLS = 80;
export const PTY_ROWS = 24;

const SCROLLBACK_LINES = 10_000;
const MAX_RESPONSE_CHARS = 500;
// Long ping messages wrap, so only match the start of the echoed prompt line.
const ECHO_MATCH_CHARS = PTY_COLS / 2;
const PROMPT_MARK = '❯';
const DIVIDER_RE = /^─{10,}/;
// Claude Code transcript markers: "●" for assistant text, "⎿" for tool/system output (errors, limits).
const MARKER_RE = /^[●⎿]\s*/;
// Spinner and turn-summary lines, e.g. "● Razzmatazzing…" or "✻ Crunched for 3s · done 6:44 PM".
const STATUS_RE = /^\S\s+(?:[A-Z][a-z]+…|\w+ for \d+[smh]\b)/;

// Claude Code redraws its TUI in place with cursor moves, so the raw stream never contains the
// reply as plain text. Replay it through a headless terminal and read the final screen instead.
function renderLines(raw: string): Promise<string[]> {
  const term = new xterm.Terminal({ cols: PTY_COLS, rows: PTY_ROWS, scrollback: SCROLLBACK_LINES, allowProposedApi: true });
  return new Promise((resolve) => {
    term.write(raw, () => {
      const buffer = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (!line) continue;
        const text = line.translateToString(true);
        if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
        else lines.push(text);
      }
      term.dispose();
      resolve(lines);
    });
  });
}

function joinText(lines: string[]): string {
  return lines.map((l) => l.trim()).filter(Boolean).join(' ').slice(0, MAX_RESPONSE_CHARS);
}

/**
 * Returns Claude's reply to `message` from a full pty transcript (startup included, since the
 * TUI positions text absolutely). Falls back to the whole turn's text if the "●"/"⎿" markers
 * change, so limit detection still sees any limit notice.
 */
export async function extractResponse(raw: string, message: string): Promise<string> {
  const lines = (await renderLines(raw)).map((l) => l.trim());
  const echo = `${PROMPT_MARK} ${message.trim().slice(0, ECHO_MATCH_CHARS)}`;
  let echoIdx = lines.length - 1;
  while (echoIdx >= 0 && !lines[echoIdx].startsWith(echo)) echoIdx--;

  // The turn's transcript: everything between the echoed prompt and the input box, minus spinners.
  const block: string[] = [];
  for (const line of lines.slice(echoIdx + 1)) {
    if (DIVIDER_RE.test(line) || line.startsWith(PROMPT_MARK)) break;
    if (line && !STATUS_RE.test(line)) block.push(line);
  }
  const firstMarker = block.findIndex((l) => MARKER_RE.test(l));
  const reply = firstMarker === -1 ? block : block.slice(firstMarker);
  return joinText(reply.map((l) => l.replace(MARKER_RE, '')));
}
