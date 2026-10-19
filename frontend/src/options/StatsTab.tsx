import { useStorageValue } from '../lib/hooks';
import { STORAGE_KEYS } from '../lib/storage';
import { computeStats } from '../lib/stats';
import { formatDuration } from '../lib/timer';
import type { BlockAttempts, SessionEntry } from '../lib/types';
import { InsightCard } from './InsightCard';

export function StatsTab() {
  const sessions = useStorageValue<SessionEntry[]>(STORAGE_KEYS.sessions, []);
  const attempts = useStorageValue<BlockAttempts>(STORAGE_KEYS.blockAttempts, {});

  const stats = computeStats(sessions, attempts);
  const max14Ms = Math.max(1, ...stats.last14.map((bar) => bar.ms));
  const maxBlocked = Math.max(1, ...stats.mostBlocked.map((entry) => entry.count));

  const cards: Array<{ label: string; value: string; sub: string }> = [
    { label: 'Today', value: formatDuration(stats.todayMs), sub: 'focused' },
    { label: 'This week', value: formatDuration(stats.weekMs), sub: 'Mon – Sun' },
    { label: 'Streak', value: `${stats.streakDays}`, sub: stats.streakDays === 1 ? 'day' : 'days', },
    { label: 'Sessions', value: `${stats.totalFocusSessions}`, sub: 'all time' },
  ];

  return (
    <div className="tab-stack">
      <InsightCard />

      <div className="stat-grid">
        {cards.map((card) => (
          <div className="stat-card" key={card.label}>
            <div className="stat-card__label">{card.label}</div>
            <div className="stat-card__value">{card.value}</div>
            <div className="stat-card__sub">{card.sub}</div>
          </div>
        ))}
      </div>

      <section className="card">
        <h2 className="card__title">Last 14 days</h2>
        <div
          className="day-bars"
          role="img"
          aria-label={`Focus time over the last 14 days: ${formatDuration(
            stats.last14.reduce((sum, bar) => sum + bar.ms, 0),
          )}`}
        >
          {stats.last14.map((bar) => (
            <div className="day-bar" key={bar.key}>
              <div className="day-bar__track" title={`${bar.label}: ${formatDuration(bar.ms)}`}>
                <div
                  className="day-bar__fill"
                  style={{ height: `${Math.max(2, (bar.ms / max14Ms) * 100)}%` }}
                />
              </div>
              <span className="day-bar__label">{bar.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Most blocked</h2>
        {stats.mostBlocked.length === 0 ? (
          <p className="muted card__hint" style={{ margin: 0 }}>
            No blocks yet. During a focus session, blocked sites show up here.
          </p>
        ) : (
          <ul className="blocked-list">
            {stats.mostBlocked.map((entry) => (
              <li key={entry.domain} className="blocked-item">
                <div className="blocked-item__head">
                  <span>{entry.domain}</span>
                  <span className="blocked-item__count">
                    {entry.count} {entry.count === 1 ? 'block' : 'blocks'}
                  </span>
                </div>
                <div className="blocked-item__track">
                  <div
                    className="blocked-item__fill"
                    style={{ width: `${(entry.count / maxBlocked) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
