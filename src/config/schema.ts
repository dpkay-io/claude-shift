export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const ALL_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const WEEKENDS: DayOfWeek[] = ['sat', 'sun'];

export interface Trigger {
  id: string;
  time: string; // HH:mm
  days: DayOfWeek[];
  source: 'manual' | 'smart';
  enabled: boolean;
  date?: string; // YYYY-MM-DD — one-time trigger, days is [] when set
  smartMeta?: {
    targetSlotStart: string;
    targetSlotEnd: string;
  };
}

export interface WorkWindow {
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface SmartConfig {
  windows: WorkWindow[];
  days: DayOfWeek[];
  burnRate: number; // hours — how long a slot effectively lasts for this user
}

export interface Settings {
  slotDuration: number; // hours, default 5
  burnRate: number; // hours, default 2
  claudePath: string; // auto-detected or manual
  nodePath: string; // auto-detected
  pingMessage: string;
  retryEnabled: boolean;
  retryIntervals: number[]; // minutes from original trigger time
}

export interface Config {
  version: 1;
  triggers: Trigger[];
  smart?: SmartConfig[];
  nextId: number;
  settings: Settings;
}
