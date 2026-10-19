/** Shared types for Zonify. The service worker is the single source of truth. */

export type Mode = 'focus' | 'short' | 'long' | 'idle';
export type ActiveMode = Exclude<Mode, 'idle'>;

/**
 * Persisted timer state. Never keep the timer in memory: MV3 service workers
 * sleep, so time left is always derived as `endsAt - Date.now()`.
 */
export interface TimerState {
  mode: Mode;
  /** Epoch ms at which the running session ends. */
  endsAt: number | null;
  /** Remaining ms while paused (mode keeps its value, isRunning false). */
  remainingMs: number | null;
  isRunning: boolean;
  /** Lifetime count of completed focus sessions. */
  completedSessions: number;
  /** 1-based position of the next focus session in the long-break cycle. */
  sessionIndex: number;
}

export interface Settings {
  /** Minutes */
  focus: number;
  /** Minutes */
  short: number;
  /** Minutes */
  long: number;
  sessionsBeforeLong: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  sound: boolean;
  notifications: boolean;
  /**
   * Opt-in: send aggregate weekly numbers to a Zonify backend for a short
   * AI-written insight. Off by default — nothing leaves the machine until
   * the user turns this on.
   */
  insightsEnabled: boolean;
  /** Base URL of the Zonify backend, e.g. "http://localhost:8787". */
  insightsApiUrl: string;
}

export interface SessionEntry {
  /** Epoch ms when the session ended. */
  endedAt: number;
  durationMs: number;
  mode: ActiveMode;
  /** True when the session was cut short (SKIP / END_EARLY) instead of timing out. */
  endedEarly?: boolean;
}

export type BlockAttempts = Record<string, number>;

/** Messages sent from popup/options/blocked pages to the service worker. */
export type TimerMessage =
  | { type: 'START'; mode?: ActiveMode }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'RESET' }
  | { type: 'SKIP' }
  | { type: 'EXTEND_BREAK' }
  | { type: 'END_EARLY' };

export const RULE_ID_MIN = 1000;
export const RULE_ID_MAX = 1999;
export const ALARM_SESSION_END = 'session-end';
export const ALARM_BADGE_TICK = 'badge-tick';
/** One live notification per finished session, identified by its kind. */
export const NOTIFICATION_FOCUS_END = 'zonify-focus-end';
export const NOTIFICATION_BREAK_END = 'zonify-break-end';
