/** Typed chrome.storage.local helpers with defaults. */
import type { Insight } from './api';
import type { BlockAttempts, SessionEntry, Settings, TimerState } from './types';

export const DEFAULT_SETTINGS: Settings = {
  focus: 25,
  short: 5,
  long: 15,
  sessionsBeforeLong: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  sound: true,
  notifications: true,
  insightsEnabled: false,
  insightsApiUrl: 'http://localhost:8787',
};

export const DEFAULT_TIMER_STATE: TimerState = {
  mode: 'idle',
  endsAt: null,
  remainingMs: null,
  isRunning: false,
  completedSessions: 0,
  sessionIndex: 1,
};

export const STORAGE_KEYS = {
  timerState: 'timerState',
  settings: 'settings',
  blocklist: 'blocklist',
  sessions: 'sessions',
  blockAttempts: 'blockAttempts',
  installId: 'installId',
  lastInsight: 'lastInsight',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Cap stored session history so storage cannot grow without bound. */
export const MAX_SESSIONS = 1000;

async function read<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

export async function getTimerState(): Promise<TimerState> {
  const state = await read<Partial<TimerState>>(STORAGE_KEYS.timerState);
  return { ...DEFAULT_TIMER_STATE, ...(state ?? {}) };
}

export async function setTimerState(state: TimerState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.timerState]: state });
}

export async function getSettings(): Promise<Settings> {
  const settings = await read<Partial<Settings>>(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function getBlocklist(): Promise<string[]> {
  const list = await read<string[]>(STORAGE_KEYS.blocklist);
  return Array.isArray(list) ? list : [];
}

export async function setBlocklist(blocklist: string[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.blocklist]: blocklist });
}

export async function getSessions(): Promise<SessionEntry[]> {
  const sessions = await read<SessionEntry[]>(STORAGE_KEYS.sessions);
  return Array.isArray(sessions) ? sessions : [];
}

export async function appendSession(entry: SessionEntry): Promise<void> {
  const sessions = await getSessions();
  sessions.push(entry);
  const trimmed = sessions.slice(-MAX_SESSIONS);
  await chrome.storage.local.set({ [STORAGE_KEYS.sessions]: trimmed });
}

export async function getBlockAttempts(): Promise<BlockAttempts> {
  const attempts = await read<BlockAttempts>(STORAGE_KEYS.blockAttempts);
  return attempts && typeof attempts === 'object' ? attempts : {};
}

/** Called by blocked.html on load: count a block per domain. */
export async function incrementBlockAttempt(domain: string): Promise<void> {
  const attempts = await getBlockAttempts();
  attempts[domain] = (attempts[domain] ?? 0) + 1;
  await chrome.storage.local.set({ [STORAGE_KEYS.blockAttempts]: attempts });
}

// ---------------------------------------------------------------------------
// AI insights (optional, opt-in)
// ---------------------------------------------------------------------------

/**
 * Stable random UUID for this install. Used only so the backend can apply a
 * per-install daily quota — it identifies the extension, not the person.
 */
export async function getInstallId(): Promise<string> {
  const existing = await read<string>(STORAGE_KEYS.installId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [STORAGE_KEYS.installId]: id });
  return id;
}

/** Last generated insight, cached so it survives closing the options page. */
export interface StoredInsight {
  insight: Insight;
  generatedAt: number;
  /** Monday of the week the insight describes (YYYY-MM-DD). */
  weekStart: string;
}

export async function getStoredInsight(): Promise<StoredInsight | undefined> {
  return read<StoredInsight>(STORAGE_KEYS.lastInsight);
}

export async function setStoredInsight(value: StoredInsight): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.lastInsight]: value });
}
