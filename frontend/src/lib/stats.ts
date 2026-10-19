/** Aggregated statistics — all bucketing uses local calendar dates. */
import { localDayKey } from './timer';
import type { BlockAttempts, SessionEntry } from './types';

export interface DayBar {
  key: string;
  label: string;
  ms: number;
}

export interface StatsSummary {
  todayMs: number;
  todayFocusCount: number;
  weekMs: number;
  /** Mon..Sun of the week containing "now". */
  weekBars: DayBar[];
  /** Consecutive local days with ≥1 focus session, ending today or yesterday. */
  streakDays: number;
  totalFocusSessions: number;
  /** Oldest → today. */
  last14: DayBar[];
  mostBlocked: { domain: string; count: number }[];
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Calendar-safe day arithmetic (DST proof): mutates a copy. */
export function dayWithOffset(base: Date, offset: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function computeStats(
  sessions: SessionEntry[],
  attempts: BlockAttempts,
  now: number = Date.now(),
): StatsSummary {
  const focus = sessions.filter((s) => s.mode === 'focus');

  const msByDay = new Map<string, number>();
  for (const s of focus) {
    const key = localDayKey(s.endedAt);
    msByDay.set(key, (msByDay.get(key) ?? 0) + s.durationMs);
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayKey = localDayKey(today.getTime());
  const todayMs = msByDay.get(todayKey) ?? 0;
  const todayFocusCount = focus.filter((s) => localDayKey(s.endedAt) === todayKey).length;

  // This week, Monday → Sunday.
  const mondayOffset = -((today.getDay() + 6) % 7);
  const weekBars: DayBar[] = [];
  for (let i = 0; i < 7; i++) {
    const key = localDayKey(dayWithOffset(today, mondayOffset + i).getTime());
    weekBars.push({ key, label: WEEKDAY_LABELS[i], ms: msByDay.get(key) ?? 0 });
  }
  const weekMs = weekBars.reduce((sum, bar) => sum + bar.ms, 0);

  // Streak: walk back from today (or yesterday when today is still empty).
  const activeDays = new Set(msByDay.keys());
  let streakDays = 0;
  let cursor = new Date(today.getTime());
  if (!activeDays.has(localDayKey(cursor.getTime()))) {
    cursor = dayWithOffset(cursor, -1);
  }
  while (activeDays.has(localDayKey(cursor.getTime()))) {
    streakDays++;
    cursor = dayWithOffset(cursor, -1);
  }

  // Last 14 local days, oldest first, ending today.
  const last14: DayBar[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = dayWithOffset(today, -i);
    const key = localDayKey(day.getTime());
    last14.push({ key, label: `${day.getMonth() + 1}/${day.getDate()}`, ms: msByDay.get(key) ?? 0 });
  }

  const mostBlocked = Object.entries(attempts)
    .map(([domain, count]) => ({ domain, count }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    .slice(0, 20);

  return {
    todayMs,
    todayFocusCount,
    weekMs,
    weekBars,
    streakDays,
    totalFocusSessions: focus.length,
    last14,
    mostBlocked,
  };
}
