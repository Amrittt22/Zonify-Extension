import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { RingDotLogo } from '../components/icons';
import { BlocklistTab } from './BlocklistTab';
import { StatsTab } from './StatsTab';
import { TimerTab } from './TimerTab';

type TabId = 'blocklist' | 'timer' | 'stats';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'blocklist', label: 'Blocklist' },
  { id: 'timer', label: 'Timer' },
  { id: 'stats', label: 'Stats' },
];

function readHash(): TabId {
  const hash = window.location.hash.replace('#', '');
  return TABS.some((t) => t.id === hash) ? (hash as TabId) : 'blocklist';
}

export function Options() {
  const [tab, setTab] = useState<TabId>(readHash);

  useEffect(() => {
    const onHashChange = () => setTab(readHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const selectTab = (id: TabId) => {
    window.location.hash = id;
    setTab(id);
  };

  const onTabListKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.id === tab);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : (index - 1 + TABS.length) % TABS.length;
    selectTab(TABS[next].id);
    document.getElementById(`tab-${TABS[next].id}`)?.focus();
  };

  return (
    <div className="options">
      <header className="options__header">
        <RingDotLogo size={30} title="Zonify" />
        <div className="options__brand">
          <span className="options__title">Zonify</span>
          <span className="options__tagline muted">Get in the zone.</span>
        </div>
      </header>

      <nav className="options__tabs" role="tablist" aria-label="Settings sections" onKeyDown={onTabListKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            className="pill"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="options__panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'blocklist' && <BlocklistTab />}
        {tab === 'timer' && <TimerTab />}
        {tab === 'stats' && <StatsTab />}
      </div>

      <footer className="options__footer muted">
        <a
          href={typeof chrome !== 'undefined' ? chrome.runtime.getURL('privacy.html') : '/privacy.html'}
          target="_blank"
          rel="noreferrer"
        >
          Privacy policy
        </a>
        <span aria-hidden="true"> · </span>
        <span>Zonify stores all data on your device.</span>
      </footer>
    </div>
  );
}
