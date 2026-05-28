import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addTrigger, removeTrigger, clearSmartTriggers } from '../src/config/manager.js';
import { defaultConfig } from '../src/config/defaults.js';
import type { Config } from '../src/config/schema.js';

describe('config manager', () => {
  let config: Config;

  beforeEach(() => {
    config = defaultConfig();
  });

  describe('addTrigger', () => {
    it('adds a trigger with auto-incremented ID', () => {
      const t = addTrigger(config, { time: '03:00', days: ['mon'], source: 'manual', enabled: true });
      expect(t.id).toBe('shift-001');
      expect(config.triggers).toHaveLength(1);
      expect(config.nextId).toBe(2);

      const t2 = addTrigger(config, { time: '15:00', days: ['fri'], source: 'smart', enabled: true });
      expect(t2.id).toBe('shift-002');
      expect(config.triggers).toHaveLength(2);
    });
  });

  describe('removeTrigger', () => {
    it('removes an existing trigger', () => {
      addTrigger(config, { time: '03:00', days: ['mon'], source: 'manual', enabled: true });
      const removed = removeTrigger(config, 'shift-001');
      expect(removed).not.toBeNull();
      expect(config.triggers).toHaveLength(0);
    });

    it('returns null for non-existent ID', () => {
      expect(removeTrigger(config, 'shift-999')).toBeNull();
    });
  });

  describe('clearSmartTriggers', () => {
    it('removes all smart triggers when no days specified', () => {
      addTrigger(config, { time: '03:00', days: ['mon'], source: 'manual', enabled: true });
      addTrigger(config, { time: '15:00', days: ['mon'], source: 'smart', enabled: true });
      addTrigger(config, { time: '20:00', days: ['mon'], source: 'smart', enabled: true });

      const removed = clearSmartTriggers(config);
      expect(removed).toBe(2);
      expect(config.triggers).toHaveLength(1);
      expect(config.triggers[0]!.source).toBe('manual');
    });

    it('removes only smart triggers for specified days', () => {
      addTrigger(config, { time: '03:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'], source: 'smart', enabled: true });
      addTrigger(config, { time: '10:00', days: ['sat', 'sun'], source: 'smart', enabled: true });

      const removed = clearSmartTriggers(config, ['sat', 'sun']);
      expect(removed).toBe(1);
      expect(config.triggers).toHaveLength(1);
      expect(config.triggers[0]!.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    });
  });
});
