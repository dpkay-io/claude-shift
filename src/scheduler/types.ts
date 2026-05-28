import type { DayOfWeek } from '../config/schema.js';

export interface ScheduledTask {
  id: string;
  command: string;
  time: string; // HH:mm
  days: DayOfWeek[];
}

export interface InstalledTask {
  id: string;
  time: string;
  days: string;
  status: 'active' | 'inactive' | 'unknown';
}

export interface SchedulerCheckResult {
  available: boolean;
  reason?: string;
}

export interface SchedulerBackend {
  readonly name: string;
  install(task: ScheduledTask): Promise<void>;
  remove(id: string): Promise<void>;
  removeAll(): Promise<void>;
  list(): Promise<InstalledTask[]>;
  check(): Promise<SchedulerCheckResult>;
}
