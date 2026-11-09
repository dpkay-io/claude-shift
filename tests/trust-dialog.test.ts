import { describe, it, expect } from 'vitest';
import { trustDialogKeys } from '../src/core/trust-dialog.js';
import { stripAnsi } from '../src/utils/text.js';

const ENTER = '\r';
const DOWN_ENTER = '\x1b[B\r';

// Claude draws the selected option with "❯" in most terminals, but with a plain ASCII ">" on
// Windows (claude 2.1.302 on msi) — the scheduled ping must read both.
const SELECTION_MARKERS = ['❯', '>'] as const;

// Verbatim pty output of `claude` 2.1.302 launched by a scheduled task on Windows (captured on msi):
// the ASCII ">" marks the default option, "No, exit". A bare Enter here makes claude exit with code 1.
const WINDOWS_TRUST_DIALOG_RAW =
  "\u001b[?25l\u001b[2J\u001b[m\u001b[H\u001b]0;claude\u0007\u001b[?25h\u001b[?2004h\u001b[?2031h\u001b[?1004h\u001b[?9001l\u001b[?25l\u001b[>0q\u001b[?u\u001b]7501;?\u0007\r\n────────────────────────────────────────────────────────────────────────────────\u001b[3;2HAccessing\u001b[1Cworkspace:\u001b[5;2HC:\\Users\\dpk\u001b[7;2HQuick\u001b[1Csafety\u001b[1Ccheck:\u001b[1CIs\u001b[1Cthis\u001b[1Ca\u001b[1Cproject\u001b[1Cyou\u001b[1Ccreated\u001b[1Cor\u001b[1Cone\u001b[1Cyou\u001b[1Ctrust?\u001b[1C(Like\u001b[1Cyour\u001b[8;2Hown\u001b[1Ccode,\u001b[1Ca\u001b[1Cwell-known\u001b[1Copen\u001b[1Csource\u001b[1Cproject,\u001b[1Cor\u001b[1Cwork\u001b[1Cfrom\u001b[1Cyour\u001b[1Cteam).\u001b[1CIf\u001b[1Cnot,\u001b[9;2Htake\u001b[1Ca\u001b[1Cmoment\u001b[1Cto\u001b[1Creview\u001b[1Cwhat's\u001b[1Cin\u001b[1Cthis\u001b[1Cfolder\u001b[1Cfirst.\u001b[11;2HClaude\u001b[1CCode'll\u001b[1Cbe\u001b[1Cable\u001b[1Cto\u001b[1Cread,\u001b[1Cedit,\u001b[1Cand\u001b[1Cexecute\u001b[1Cfiles\u001b[1Chere.\u001b[13;2HSecurity\u001b[1Cguide\u001b[15;2H>\u001b[1CNo,\u001b[1Cexit\u001b[16;4HYes,\u001b[1CI\u001b[1Ctrust\u001b[1Cthis\u001b[1Cfolder\u001b[18;2HEnter\u001b[1Cto\u001b[1Cconfirm\u001b[1C·\u001b[1CEsc\u001b[1Cto\u001b[1Ccancel";

describe('trustDialogKeys', () => {
  it('moves down before Enter on the real Windows dialog ("> No, exit" is the default)', () => {
    expect(trustDialogKeys(stripAnsi(WINDOWS_TRUST_DIALOG_RAW))).toBe(DOWN_ENTER);
  });

  it('moves down before Enter when "No, exit" is highlighted (claude 2.1.x raw output)', () => {
    const raw = '\u001b[2GQuick\u001b[8Gsafety\u001b[15Gcheck:\r\r\n\u001b[2G\u001b[38;2;177;185;249m❯\u001b[4GNo,\u001b[8Gexit\u001b[39m\r\r\n\u001b[4GYes,\u001b[9GI\u001b[11Gtrust\u001b[17Gthis\u001b[22Gfolder\r\r\n';
    expect(trustDialogKeys(stripAnsi(raw))).toBe(DOWN_ENTER);
  });

  describe.each(SELECTION_MARKERS)('with the "%s" selection marker', (mark) => {
    it('moves down before Enter when "No, exit" is highlighted', () => {
      expect(trustDialogKeys(`${mark} No, exit\n  Yes, I trust this folder`)).toBe(DOWN_ENTER);
    });

    it('presses plain Enter when "Yes" is highlighted', () => {
      expect(trustDialogKeys(`${mark} Yes, I trust this folder\n  No, exit`)).toBe(ENTER);
    });

    it('reads the highlight when stripAnsi has glued the words together', () => {
      expect(trustDialogKeys(`Securityguide${mark}No,exitYes,ItrustthisfolderEntertoconfirm`)).toBe(DOWN_ENTER);
      expect(trustDialogKeys(`Securityguide${mark}Yes,ItrustthisfolderNo,exitEntertoconfirm`)).toBe(ENTER);
    });

    it('handles numbered options', () => {
      expect(trustDialogKeys(`${mark} 1. No, exit\n  2. Yes, I trust this folder`)).toBe(DOWN_ENTER);
      expect(trustDialogKeys(`${mark} 1. Yes, I trust this folder\n  2. No, exit`)).toBe(ENTER);
    });

    it('uses the most recent highlight when the dialog is redrawn', () => {
      expect(trustDialogKeys(`${mark} No, exit\n  Yes, I trust this folder\n${mark} Yes, I trust this folder`)).toBe(ENTER);
    });

    it('ignores the later input prompt marker', () => {
      expect(trustDialogKeys(`${mark} No, exit\n  Yes, I trust this folder\n${mark} Try "fix type errors"`)).toBe(DOWN_ENTER);
    });
  });

  it('does not mistake arrows or comparisons for a selection marker', () => {
    expect(trustDialogKeys('go -> No, thanks')).toBe(ENTER);
    expect(trustDialogKeys('x => no longer')).toBe(ENTER);
    expect(trustDialogKeys('a >> no')).toBe(ENTER);
  });

  it('falls back to Enter when no highlight is found', () => {
    expect(trustDialogKeys('Yes, I trust this folder')).toBe(ENTER);
    expect(trustDialogKeys('')).toBe(ENTER);
  });
});
