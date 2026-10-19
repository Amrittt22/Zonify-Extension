/**
 * Maps local stats into the exact payload the Zonify backend accepts.
 *
 * Privacy: this is the whole vocabulary that can ever leave the machine —
 * whole minutes, session counts, a streak and blocked-domain counters. No
 * URLs, page titles, timestamps or history are representable here, and every
 * value is clamped to the backend's schema before it is sent.
 */
import { normalizeDomain } from './domain';
import { dayWithOffset } from './stats';
import { localDayKey } from './timer';
import type { BlockAttempts, SessionEntry, Settings } from './types';

export interface InsightSummary {
  /** Human label for the week, e.g. "Oct 13 - Oct 19" (≤ 40 chars). */
  week: string;
  totalFocusMinutes: number;
  sessionsCompleted: number;
  sessionsStartedButEndedEarly: number;
  streakDays: number;
  minutesByDay: { Mon: number; Tue: number; Wed: number; Thu: number; Fri: number; Sat: number; Sun: number };
  minutesByHourBucket: { morning: number; afternoon: number; evening: number };
  topBlockedDomains: Array<{ domain: string; attempts: number }>;
  previousWeekFocusMinutes: number | null;
}

/** Mirrors the backend schema — clamp before sending, never trust UI state. */
const MINUTE_MAX = 10080;
const SESSION_MAX = 500;
const STREAK_MAX = 3650;
const ATTEMPTS_MAX = 100000;
const TOP_DOMAINS_MAX = 3;

/** Legacy sessions have no `endedEarly` flag: treat "well short of target" as early. */
const EARLY_TOLERANCE_MS = 60_000;

/**
 * The backend only accepts dotted lowercase hostnames, so anything else
 * (e.g. "localhost") is dropped rather than sent and rejected wholesale.
 */
const BACKEND_HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export interface SummaryInput {
  sessions: SessionEntry[];
  attempts: BlockAttempts;
  settings: Pick<Settings, 'focus'>;
  streakDays: number;
  now?: number;
}

const WEEKDAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const toMinutes = (ms: number): number =>
  Math.min(MINUTE_MAX, Math.max(0, Math.round(ms / 60_000)));

const toCount = (value: number, max: number): number =>
  Math.min(max, Math.max(0, Math.trunc(value)));

/** Midnight on the Monday of the week containing `now`. */
function startOfWeek(now: number): Date {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return dayWithOffset(today, -((today.getDay() + 6) % 7));
}

/** YYYY-MM-DD of the week's Monday — used to expire the cached insight. */
export function weekStartKey(now: number = Date.now()): string {
  return localDayKey(startOfWeek(now).getTime());
}

export function formatWeekLabel(start: Date, end: Date): string {
  const fmt = (date: Date): string =>
    date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(start)} - ${fmt(end)}`.slice(0, 40);
}

function isEarly(session: SessionEntry, focusMs: number): boolean {
  if (typeof session.endedEarly === 'boolean') return session.endedEarly;
  return session.durationMs < focusMs - EARLY_TOLERANCE_MS;
}

export function buildSummary(input: SummaryInput): InsightSummary {
  const now = input.now ?? Date.now();
  const weekStart = startOfWeek(now);
  const focusSessions = input.sessions.filter((session) => session.mode === 'focus');

  // This week's Monday..Sunday in local days.
  const weekKeys = WEEKDAY_KEYS.map((_, index) =>
    localDayKey(dayWithOffset(weekStart, index).getTime()),
  );
  const msByDay = new Map<string, number>(weekKeys.map((key) => [key, 0]));

  const minutesByDay = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
  const hourBucketMs = { morning: 0, afternoon: 0, evening: 0 };
  let weekMs = 0;
  let completed = 0;
  let endedEarly = 0;

  const focusMs = input.settings.focus * 60_000;

  for (const session of focusSessions) {
    const key = localDayKey(session.endedAt);
    if (!msByDay.has(key)) continue; // not this week

    msByDay.set(key, (msByDay.get(key) ?? 0) + session.durationMs);
    weekMs += session.durationMs;
    completed += 1;
    if (isEarly(session, focusMs)) endedEarly += 1;

    // Bucket by the hour the session *started* (a session counts once).
    const hour = new Date(session.endedAt - session.durationMs).getHours();
    const bucket =
      hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening';
    hourBucketMs[bucket] += session.durationMs;
  }

  weekKeys.forEach((key, index) => {
    minutesByDay[WEEKDAY_KEYS[index]] = toMinutes(msByDay.get(key) ?? 0);
  });

  // Previous week: null means "no data", 0 would mean "a week of nothing".
  const previousKeys = new Set(
    WEEKDAY_KEYS.map((_, index) => localDayKey(dayWithOffset(weekStart, index - 7).getTime())),
  );
  let previousMs = 0;
  let previousSessions = 0;
  for (const session of focusSessions) {
    if (!previousKeys.has(localDayKey(session.endedAt))) continue;
    previousMs += session.durationMs;
    previousSessions += 1;
  }

  const topBlockedDomains = Object.entries(input.attempts)
    .map(([domain, count]) => ({ domain: normalizeDomain(domain), count }))
    .filter((entry): entry is { domain: string; count: number } => entry.domain !== null)
    .filter((entry) => BACKEND_HOSTNAME_RE.test(entry.domain))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    .slice(0, TOP_DOMAINS_MAX)
    .map((entry) => ({ domain: entry.domain, attempts: toCount(entry.count, ATTEMPTS_MAX) }));

  return {
    week: formatWeekLabel(weekStart, dayWithOffset(weekStart, 6)),
    totalFocusMinutes: toMinutes(weekMs),
    sessionsCompleted: toCount(completed, SESSION_MAX),
    sessionsStartedButEndedEarly: toCount(endedEarly, SESSION_MAX),
    streakDays: toCount(input.streakDays, STREAK_MAX),
    minutesByDay,
    minutesByHourBucket: {
      morning: toMinutes(hourBucketMs.morning),
      afternoon: toMinutes(hourBucketMs.afternoon),
      evening: toMinutes(hourBucketMs.evening),
    },
    topBlockedDomains,
    previousWeekFocusMinutes: previousSessions === 0 ? null : toMinutes(previousMs),
  };
}
