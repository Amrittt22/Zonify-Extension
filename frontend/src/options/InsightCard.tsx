import { useState } from 'react';
import { InsightError, requestInsight } from '../lib/api';
import { useStorageValue } from '../lib/hooks';
import { buildSummary, weekStartKey } from '../lib/insights';
import { computeStats } from '../lib/stats';
import {
  DEFAULT_SETTINGS,
  getInstallId,
  setStoredInsight,
  STORAGE_KEYS,
  type StoredInsight,
} from '../lib/storage';
import { formatDuration } from '../lib/timer';
import type { BlockAttempts, SessionEntry, Settings } from '../lib/types';

/** The backend refuses fewer than 3 completed sessions; mirror that here. */
const MIN_SESSIONS = 3;

function formatRelative(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function goToTimerTab() {
  window.location.hash = 'timer';
}

export function InsightCard() {
  const settings = useStorageValue<Settings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS, (stored) => ({
    ...DEFAULT_SETTINGS,
    ...stored,
  }));
  const sessions = useStorageValue<SessionEntry[]>(STORAGE_KEYS.sessions, []);
  const attempts = useStorageValue<BlockAttempts>(STORAGE_KEYS.blockAttempts, {});
  const stored = useStorageValue<StoredInsight | undefined>(STORAGE_KEYS.lastInsight, undefined);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stats = computeStats(sessions, attempts);
  const summary = buildSummary({ sessions, attempts, settings, streakDays: stats.streakDays });
  const weekKey = weekStartKey();
  const current = stored && stored.weekStart === weekKey ? stored : null;
  const enoughData = summary.sessionsCompleted >= MIN_SESSIONS;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const installId = await getInstallId();
      const insight = await requestInsight({
        apiUrl: settings.insightsApiUrl,
        installId,
        summary,
      });
      await setStoredInsight({ insight, generatedAt: Date.now(), weekStart: weekKey });
    } catch (err) {
      setError(
        err instanceof InsightError
          ? err.message
          : 'Something went wrong generating the insight. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (!settings.insightsEnabled) {
    return (
      <section className="card">
        <h2 className="card__title">Weekly insight</h2>
        <p className="insight__privacy muted" style={{ margin: 0 }}>
          AI insights are off — nothing has left your machine.{' '}
          <button type="button" className="linkish" onClick={goToTimerTab}>
            Turn them on in the Timer tab
          </button>{' '}
          to add a short summary of your week here.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="insight__row">
        <h2 className="card__title" style={{ margin: 0 }}>
          Weekly insight
        </h2>
        {current && <span className="muted insight__stamp">Generated {formatRelative(current.generatedAt)}</span>}
      </div>

      {current ? (
        <article className="insight">
          <h3 className="insight__headline">{current.insight.headline}</h3>
          <ul className="insight__list">
            {current.insight.highlights.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
          <p className="insight__suggestion">{current.insight.suggestion}</p>
        </article>
      ) : (
        <p className="insight__privacy" style={{ margin: '4px 0 0' }}>
          {enoughData
            ? `Ready when you are — ${formatDuration(stats.weekMs)} focused this week.`
            : `Complete ${MIN_SESSIONS} focus sessions this week to unlock an insight (${summary.sessionsCompleted} so far).`}
        </p>
      )}

      <div className="insight__actions">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => void generate()}
          disabled={busy || !enoughData}
        >
          {busy ? 'Writing…' : current ? 'New insight' : 'Generate insight'}
        </button>
        <span className="muted insight__stamp" aria-live="polite">
          {busy ? `Asking ${settings.insightsApiUrl}…` : ''}
        </span>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <p className="insight__privacy muted">
        Sends only weekly totals — minutes focused, session counts, streak, focus time by day and time
        of day, and blocked-site counts — to <strong>{settings.insightsApiUrl}</strong>. Never URLs,
        page titles or history.
      </p>
    </section>
  );
}
