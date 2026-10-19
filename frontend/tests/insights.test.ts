import { describe, expect, it } from 'vitest';
import { buildSummary, formatWeekLabel, weekStartKey } from '../src/lib/insights';
import type { SessionEntry } from '../src/lib/types';

// Monday 19 Oct 2026, 15:00 local — the Monday of the week under test.
const NOW = new Date(2026, 9, 19, 15, 0, 0).getTime();

const FOCUS_MS = 25 * 60_000;

function focus(startISO: string, minutes: number, endedEarly?: boolean): SessionEntry {
  const endedAt = new Date(startISO).getTime() + minutes * 60_000;
  return { endedAt, durationMs: minutes * 60_000, mode: 'focus', ...(endedEarly === undefined ? {} : { endedEarly }) };
}

const SETTINGS = { focus: 25 };

/** Mon + Tue + Wed + Sun this week, one previous-week session, one old one. */
function seedSessions(): SessionEntry[] {
  return [
    focus('2026-10-19T09:30:00', 25), // Mon morning
    focus('2026-10-20T14:00:00', 25), // Tue afternoon
    focus('2026-10-21T10:00:00', 10, true), // Wed morning, ended early
    focus('2026-10-25T20:00:00', 25), // Sun evening
    focus('2026-10-12T09:00:00', 25), // previous week
    focus('2026-09-01T09:00:00', 60), // long ago
    { endedAt: new Date('2026-10-19T11:00:00').getTime(), durationMs: 5 * 60_000, mode: 'short' },
  ];
}

describe('buildSummary', () => {
  it('produces the backend payload shape for a normal week', () => {
    const summary = buildSummary({
      sessions: seedSessions(),
      attempts: { 'youtube.com': 84, 'twitter.com': 41, 'reddit.com': 17, 'news.ycombinator.com': 3 },
      settings: SETTINGS,
      streakDays: 3,
      now: NOW,
    });

    expect(summary.totalFocusMinutes).toBe(85);
    expect(summary.sessionsCompleted).toBe(4);
    expect(summary.sessionsStartedButEndedEarly).toBe(1);
    expect(summary.streakDays).toBe(3);
    expect(summary.minutesByDay).toEqual({ Mon: 25, Tue: 25, Wed: 10, Thu: 0, Fri: 0, Sat: 0, Sun: 25 });
    expect(summary.minutesByHourBucket).toEqual({ morning: 35, afternoon: 25, evening: 25 });
    expect(summary.previousWeekFocusMinutes).toBe(25);
    expect(summary.topBlockedDomains).toEqual([
      { domain: 'youtube.com', attempts: 84 },
      { domain: 'twitter.com', attempts: 41 },
      { domain: 'reddit.com', attempts: 17 },
    ]);
    expect(summary.week.length).toBeGreaterThan(0);
    expect(summary.week.length).toBeLessThanOrEqual(40);
  });

  it('reports null previousWeekFocusMinutes when last week had no focus', () => {
    const summary = buildSummary({
      sessions: [focus('2026-10-19T09:30:00', 25)],
      attempts: {},
      settings: SETTINGS,
      streakDays: 1,
      now: NOW,
    });
    expect(summary.previousWeekFocusMinutes).toBeNull();
    expect(summary.topBlockedDomains).toEqual([]);
  });

  it('ignores breaks and sessions outside this week', () => {
    const summary = buildSummary({
      sessions: [
        focus('2026-08-01T09:00:00', 200),
        { endedAt: NOW, durationMs: 30 * 60_000, mode: 'long' },
      ],
      attempts: {},
      settings: SETTINGS,
      streakDays: 0,
      now: NOW,
    });
    expect(summary.totalFocusMinutes).toBe(0);
    expect(summary.sessionsCompleted).toBe(0);
  });

  it('treats short legacy sessions as ended early when the flag is missing', () => {
    const legacyShort: SessionEntry = { endedAt: NOW, durationMs: 5 * 60_000, mode: 'focus' };
    const legacyFull: SessionEntry = { endedAt: NOW, durationMs: FOCUS_MS, mode: 'focus' };
    const summary = buildSummary({
      sessions: [legacyShort, legacyFull],
      attempts: {},
      settings: SETTINGS,
      streakDays: 1,
      now: NOW,
    });
    expect(summary.sessionsStartedButEndedEarly).toBe(1);
  });

  it('clamps every value to the backend schema', () => {
    const summary = buildSummary({
      sessions: [{ endedAt: NOW, durationMs: 40 * 24 * 60 * 60_000, mode: 'focus' }], // absurdly long
      attempts: { 'a.com': 5_000_000, 'localhost': 10, 'UPPER.com': 4, 'b.com': 1, 'c.com': 1 },
      settings: SETTINGS,
      streakDays: 99_999,
      now: NOW,
    });
    expect(summary.totalFocusMinutes).toBe(10080);
    expect(summary.minutesByDay.Mon).toBe(10080);
    expect(summary.sessionsCompleted).toBe(1);
    expect(summary.streakDays).toBe(3650);
    expect(summary.topBlockedDomains.length).toBeLessThanOrEqual(3);
    expect(summary.topBlockedDomains[0]).toEqual({ domain: 'a.com', attempts: 100000 });
    // "localhost" is not a dotted hostname the backend accepts.
    expect(summary.topBlockedDomains.map((entry) => entry.domain)).not.toContain('localhost');
  });
});

describe('week helpers', () => {
  it('weekStartKey is the local Monday', () => {
    expect(weekStartKey(NOW)).toBe('2026-10-19');
  });

  it('formatWeekLabel stays within the 40 char limit', () => {
    const label = formatWeekLabel(new Date(2026, 9, 19), new Date(2026, 9, 25));
    // Locale-dependent ordering ("Oct 19" / "19 Oct") — just require both days.
    expect(label).toContain('19');
    expect(label).toContain('25');
    expect(label).toContain('-');
    expect(label.length).toBeLessThanOrEqual(40);
  });
});
