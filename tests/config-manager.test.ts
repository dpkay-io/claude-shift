import { describe, it, expect, beforeEach } from 'vitest';
import { addTrigger, removeTrigger, clearSmartTriggers, findTrigger } from '../src/config/manager.js';
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
      expect(t.id).toBe('001');
      expect(config.triggers).toHaveLength(1);
      expect(config.nextId).toBe(2);

      const t2 = addTrigger(config, { time: '15:00', days: ['fri'], source: 'smart', enabled: true });
      expect(t2.id).toBe('002');
      expect(config.triggers).toHaveLength(2);
    });
  });

  describe('removeTrigger', () => {
    it('removes an existing trigger', () => {
      addTrigger(config, { time: '03:00', days: ['mon'], source: 'manual', enabled: true });
      const removed = removeTrigger(config, '001');
      expect(removed).not.toBeNull();
      expect(config.triggers).toHaveLength(0);
    });

    it('returns null for non-existent ID', () => {
      expect(removeTrigger(config, '999')).toBeNull();
    });
  });

  describe('clearSmartTriggers', () => {
    it('removes all smart triggers when no days specified', () => {
      addTrigger(config, { time: '03:00', days: ['mon'], source: 'manual', enabled: true });
      addTrigger(config, { time: '15:00', days: ['mon'], source: 'smart', enabled: true });
      addTrigger(config, { time: '20:00', days: ['mon'], source: 'smart', enabled: true });

      const removed = clearSmartTriggers(config);
      expect(removed).toHaveLength(2);
      expect(removed.every(t => t.source === 'smart')).toBe(true);
      expect(config.triggers).toHaveLength(1);
      expect(config.triggers[0]!.source).toBe('manual');
    });

    it('removes only smart triggers for specified days', () => {
      addTrigger(config, { time: '03:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'], source: 'smart', enabled: true });
      addTrigger(config, { time: '10:00', days: ['sat', 'sun'], source: 'smart', enabled: true });

      const removed = clearSmartTriggers(config, ['sat', 'sun']);
      expect(removed).toHaveLength(1);
      expect(removed[0]!.days).toEqual(['sat', 'sun']);
      expect(config.triggers).toHaveLength(1);
      expect(config.triggers[0]!.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    });
  });

  describe('findTrigger', () => {
    it('finds an existing trigger by ID', () => {
      addTrigger(config, { time: '03:00', days: ['mon'], source: 'manual', enabled: true });
      const found = findTrigger(config, '001');
      expect(found).toBeDefined();
      expect(found!.time).toBe('03:00');
    });

    it('returns undefined for non-existent ID', () => {
      expect(findTrigger(config, '999')).toBeUndefined();
    });
  });

  describe('addTrigger ID format', () => {
    it('pads IDs to 3 digits', () => {
      const t = addTrigger(config, { time: '03:00', days: ['mon'], source: 'manual', enabled: true });
      expect(t.id).toBe('001');
    });

    it('handles IDs beyond 999', () => {
      config.nextId = 1000;
      const t = addTrigger(config, { time: '03:00', days: ['mon'], source: 'manual', enabled: true });
      expect(t.id).toBe('1000');
      expect(config.nextId).toBe(1001);
    });
  });
});
