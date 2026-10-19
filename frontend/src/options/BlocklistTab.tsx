import { useState } from 'react';
import type { FormEvent } from 'react';
import { CloseIcon } from '../components/icons';
import { normalizeDomain } from '../lib/domain';
import { useStorageValue } from '../lib/hooks';
import { setBlocklist, STORAGE_KEYS } from '../lib/storage';
import { computeStats } from '../lib/stats';
import { formatDuration } from '../lib/timer';
import type { BlockAttempts, SessionEntry } from '../lib/types';

export function BlocklistTab() {
  const blocklist = useStorageValue<string[]>(STORAGE_KEYS.blocklist, []);
  const sessions = useStorageValue<SessionEntry[]>(STORAGE_KEYS.sessions, []);
  const attempts = useStorageValue<BlockAttempts>(STORAGE_KEYS.blockAttempts, {});

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const stats = computeStats(sessions, attempts);
  const maxWeekMs = Math.max(1, ...stats.weekBars.map((bar) => bar.ms));

  const addSite = (event: FormEvent) => {
    event.preventDefault();
    const domain = normalizeDomain(draft);
    if (!domain) {
      setError('Enter a valid domain, like example.com');
      return;
    }
    if (blocklist.includes(domain)) {
      setError('That site is already blocked.');
      return;
    }
    setError(null);
    setDraft('');
    void setBlocklist([...blocklist, domain]);
  };

  const removeSite = (domain: string) => {
    void setBlocklist(blocklist.filter((d) => d !== domain));
  };

  return (
    <div className="tab-stack">
      <section className="card">
        <h2 className="card__title">Blocked sites</h2>
        <form className="blocklist-form" onSubmit={addSite}>
          <label className="sr-only" htmlFor="blocklist-input">
            Add a site to block
          </label>
          <input
            id="blocklist-input"
            className="field"
            placeholder="Add a site, e.g. tiktok.com"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'blocklist-error' : undefined}
          />
          <button type="submit" className="btn btn--primary">
            Add
          </button>
        </form>
        {error && (
          <p className="form-error" id="blocklist-error" role="alert">
            {error}
          </p>
        )}

        <ul className="blocklist">
          {blocklist.length === 0 && (
            <li className="blocklist__empty muted">
              No sites blocked yet. Add one above to start blocking during focus sessions.
            </li>
          )}
          {blocklist.map((domain) => (
            <li key={domain} className="blocklist__row">
              <span className="blocklist__domain">{domain}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${domain} from blocklist`}
                onClick={() => removeSite(domain)}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="card__title">This week</h2>
        <div
          className="week-bars"
          role="img"
          aria-label={`Focus time this week: ${formatDuration(stats.weekMs)}`}
        >
          {stats.weekBars.map((bar) => (
            <div className="week-bar" key={bar.key}>
              <div
                className="week-bar__track"
                title={`${bar.label}: ${formatDuration(bar.ms)}`}
              >
                <div
                  className="week-bar__fill"
                  style={{ height: `${Math.max(2, (bar.ms / maxWeekMs) * 100)}%` }}
                />
              </div>
              <span className="week-bar__label">{bar.label}</span>
            </div>
          ))}
        </div>
        <div className="week-meta">
          <span>
            <strong className="tabular">{formatDuration(stats.weekMs)}</strong>{' '}
            <span className="muted">focused</span>
          </span>
          <span>
            <strong className="tabular">{stats.streakDays}</strong>{' '}
            <span className="muted">day streak</span>
          </span>
        </div>
      </section>
    </div>
  );
}
