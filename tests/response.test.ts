import { describe, it, expect } from 'vitest';
import { extractResponse } from '../src/core/response.js';
import { detectLimitHit } from '../src/core/ping.js';

const ESC = '\x1b';
const at = (row: number, col: number): string => `${ESC}[${row};${col}H`;
const EL = `${ESC}[K`;
const DIVIDER = '─'.repeat(80);

// Mirrors how Claude Code 2.1.x draws a turn: the spinner is printed on the "●" row and the reply
// later overwrites it in place via cursor positioning, so the reply never follows the prompt in the stream.
function turn(message: string, replyRows: string[]): string {
  return [
    `${ESC}[2J${at(1, 1)}${ESC}]0;claude\x07`,
    `${at(9, 1)}❯ ${message}${EL}\r\n${EL}\r\n● Razzmatazzing…${EL}`,
    `${at(13, 1)}${DIVIDER}\r\n❯ \r\n${DIVIDER}${at(16, 3)}~  opus-5-5  ctx:6%  5h:5%@23:00`,
    `${at(11, 18)}(Tracking ponytail mode… 0/2 · 0s)`,
    ...replyRows.map((text, i) => `${at(11 + i, 3)}${text}${EL}`),
    `${at(11 + replyRows.length + 1, 1)}✻ Crunched for 3s · done 6:44 PM${EL}`,
    `${at(15, 1)}❯ /exit${EL}\r\n${EL}\r\n● Actioning…${EL}`,
    `${at(24, 1)}\r\nResume this session with:\r\nclaude --resume 20288cfa-243f-48a8-a94b-10cee777f7e0\r\n`,
  ].join('');
}

describe('extractResponse', () => {
  it('returns only the reply that overwrote the spinner', async () => {
    expect(await extractResponse(turn('ping', ['pong']), 'ping')).toBe('pong');
  });

  it('joins a multi-line reply', async () => {
    const raw = turn('ping', ['Pong! Ready', 'when you are.']);
    expect(await extractResponse(raw, 'ping')).toBe('Pong! Ready when you are.');
  });

  it('keeps a limit notice shown as tool/system output so limits are still detected', async () => {
    const raw = [
      `${ESC}[2J${at(9, 1)}❯ ping${EL}`,
      `${at(11, 1)}  ⎿  You've hit your weekly limit · resets Oct 19, 7:30pm${EL}`,
      `${at(13, 1)}${DIVIDER}\r\n❯ ${EL}`,
    ].join('');
    const resp = await extractResponse(raw, 'ping');
    expect(resp).toBe("You've hit your weekly limit · resets Oct 19, 7:30pm");
    expect(detectLimitHit(resp)?.type).toBe('weekly');
  });

  it('falls back to all text after the prompt when no reply markers are present', async () => {
    const raw = `${ESC}[2J${at(1, 1)}❯ ping\r\nUsage limit reached for today\r\n`;
    expect(await extractResponse(raw, 'ping')).toBe('Usage limit reached for today');
  });

  it('returns an empty string when Claude never answered', async () => {
    const raw = `${ESC}[2J${at(9, 1)}❯ ping${EL}\r\n\r\n● Razzmatazzing…${at(13, 1)}${DIVIDER}`;
    expect(await extractResponse(raw, 'ping')).toBe('');
  });
});
