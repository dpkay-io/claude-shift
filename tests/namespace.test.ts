import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  NAMESPACE_ENV, configDir, schtasksPrefix, launchdLabelPrefix, cronTagPrefix, namespaceArgs,
} from '../src/config/namespace.js';

const original = process.env[NAMESPACE_ENV];

afterEach(() => {
  if (original === undefined) delete process.env[NAMESPACE_ENV];
  else process.env[NAMESPACE_ENV] = original;
});

describe('namespace', () => {
  it('uses the real install names when unset', () => {
    delete process.env[NAMESPACE_ENV];
    expect(configDir()).toBe(path.join(os.homedir(), '.claude-shift'));
    expect(schtasksPrefix()).toBe('claude-shift-');
    expect(launchdLabelPrefix()).toBe('com.claude-shift.');
    expect(cronTagPrefix()).toBe('# claude-shift:');
    expect(namespaceArgs()).toBe('');
  });

  it('isolates config dir and every scheduler name when set', () => {
    process.env[NAMESPACE_ENV] = 'e2e-test';
    expect(configDir()).toBe(path.join(os.homedir(), '.claude-shift-e2e-test'));
    expect(schtasksPrefix()).toBe('claude-shift-e2e-test-');
    expect(launchdLabelPrefix()).toBe('com.claude-shift-e2e-test.');
    expect(cronTagPrefix()).toBe('# claude-shift-e2e-test:');
    expect(namespaceArgs()).toBe(' --namespace e2e-test');
  });

  it('never lets an isolated instance match the real install entries', () => {
    process.env[NAMESPACE_ENV] = 'e2e-test';
    // launchd and cron select their entries by prefix; the real ones must not match.
    expect('com.claude-shift.001.plist'.startsWith(launchdLabelPrefix())).toBe(false);
    expect('0 9 * * 1 node runner.js # claude-shift:001'.includes(cronTagPrefix())).toBe(false);
    expect('claude-shift-001'.startsWith(schtasksPrefix())).toBe(false);
  });

  it.each(['E2E', 'a b', 'x;rm', '../x', '-x', 'x-', 'a--b'])('rejects unsafe name %j', (ns) => {
    process.env[NAMESPACE_ENV] = ns;
    expect(() => configDir()).toThrow(NAMESPACE_ENV);
  });
});
