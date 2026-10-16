import { describe, it, expect } from 'vitest';
import { trustDialogKeys } from '../src/core/ping.js';
import { stripAnsi } from '../src/utils/text.js';

const ENTER = '\r';
const DOWN_ENTER = '\x1b[B\r';

describe('trustDialogKeys', () => {
  it('moves down before Enter when "No, exit" is highlighted (claude 2.1.x raw output)', () => {
    const raw = '\u001b[2GQuick\u001b[8Gsafety\u001b[15Gcheck:\r\r\n\u001b[2G\u001b[38;2;177;185;249m❯\u001b[4GNo,\u001b[8Gexit\u001b[39m\r\r\n\u001b[4GYes,\u001b[9GI\u001b[11Gtrust\u001b[17Gthis\u001b[22Gfolder\r\r\n';
    expect(trustDialogKeys(stripAnsi(raw))).toBe(DOWN_ENTER);
  });

  it('presses plain Enter when "Yes" is highlighted', () => {
    expect(trustDialogKeys('❯ Yes, I trust this folder\n  No, exit')).toBe(ENTER);
  });

  it('handles numbered options', () => {
    expect(trustDialogKeys('❯ 1. No, exit\n  2. Yes, I trust this folder')).toBe(DOWN_ENTER);
    expect(trustDialogKeys('❯ 1. Yes, I trust this folder\n  2. No, exit')).toBe(ENTER);
  });

  it('uses the most recent highlight when the dialog is redrawn', () => {
    expect(trustDialogKeys('❯ No, exit\n  Yes, I trust this folder\n❯ Yes, I trust this folder')).toBe(ENTER);
  });

  it('falls back to Enter when no highlight is found', () => {
    expect(trustDialogKeys('Yes, I trust this folder')).toBe(ENTER);
    expect(trustDialogKeys('')).toBe(ENTER);
  });

  it('ignores the later input prompt marker', () => {
    expect(trustDialogKeys('❯ No, exit\n  Yes, I trust this folder\n❯ Try "fix type errors"')).toBe(DOWN_ENTER);
  });
});
