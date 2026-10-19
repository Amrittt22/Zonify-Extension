import { useEffect } from 'react';
import { LockIcon } from '../components/icons';
import { useStorageValue, useTick } from '../lib/hooks';
import { incrementBlockAttempt, DEFAULT_SETTINGS, DEFAULT_TIMER_STATE, STORAGE_KEYS } from '../lib/storage';
import { formatClock, isBreakMode } from '../lib/timer';
import type { Settings, TimerState } from '../lib/types';

/** Guard against double-counting (dev StrictMode runs effects twice). */
const countedDomains = new Set<string>();

function readSiteParam(): string {
  return new URLSearchParams(window.location.search).get('site')?.trim().toLowerCase() ?? '';
}

export function Blocked() {
  const site = readSiteParam();
  const timerState = useStorageValue<TimerState>(STORAGE_KEYS.timerState, DEFAULT_TIMER_STATE);
  const settings = useStorageValue<Settings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS, (stored) => ({
    ...DEFAULT_SETTINGS,
    ...stored,
  }));
  const now = useTick(250);

  // Count this block once per page load.
  useEffect(() => {
    if (!site || countedDomains.has(site)) return;
    countedDomains.add(site);
    incrementBlockAttempt(site).catch(() => {
      /* storage unavailable */
    });
  }, [site]);

  const focusActive = timerState.mode === 'focus' && timerState.isRunning;
  const breakActive = isBreakMode(timerState.mode) && timerState.isRunning;
  const remainingMs =
    timerState.isRunning && timerState.endsAt !== null ? Math.max(0, timerState.endsAt - now) : 0;

  const backToWork = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    chrome.tabs
      .getCurrent()
      .then((tab) => {
        if (tab?.id !== undefined) return chrome.tabs.remove(tab.id);
        return undefined;
      })
      .catch(() => {
        /* cannot resolve tab */
      });
  };

  const endEarly = () => {
    chrome.runtime
      .sendMessage({ type: 'END_EARLY' })
      .catch(() => {
        /* worker unavailable */
      })
      .finally(() => {
        backToWork();
      });
  };

  const copy = focusActive ? (
    <>
      <strong>{site || 'This site'}</strong> is blocked until your focus session ends.
    </>
  ) : breakActive ? (
    <>
      <strong>{site || 'This site'}</strong> is unblocked — enjoy your break.
    </>
  ) : (
    <>
      <strong>{site || 'This site'}</strong> is unblocked. Your session is over.
    </>
  );

  const countClass = focusActive
    ? 'blocked__count'
    : breakActive
      ? 'blocked__count blocked__count--break'
      : 'blocked__count blocked__count--done';

  const cycle = Math.max(1, settings.sessionsBeforeLong);
  const sessionIndex = Math.min(Math.max(1, timerState.sessionIndex), cycle);

  return (
    <div className="blocked">
      <div
        className={`lock-ring ${focusActive ? '' : 'lock-ring--dim'}`}
        aria-hidden="true"
      >
        <LockIcon size={34} />
      </div>

      <h1 className="blocked__title">You&rsquo;re in the zone.</h1>
      <p className="blocked__copy">{copy}</p>

      <div
        className={countClass}
        role="timer"
        aria-label={
          focusActive || breakActive
            ? `${Math.floor(remainingMs / 60000)} minutes ${Math.floor((remainingMs % 60000) / 1000)} seconds remaining`
            : 'Session ended'
        }
      >
        {focusActive || breakActive ? formatClock(remainingMs) : '00:00'}
      </div>

      {focusActive && (
        <div
          className="session-dots"
          role="img"
          aria-label={`Session ${sessionIndex} of ${cycle}`}
        >
          {Array.from({ length: cycle }, (_, i) => {
            const position = i + 1;
            const state =
              position < sessionIndex ? 'done' : position === sessionIndex ? 'current' : 'future';
            return <span key={position} className={`dot dot--${state}`} aria-hidden="true" />;
          })}
        </div>
      )}

      <div className="blocked__actions">
        <button type="button" className="btn btn--primary btn--wide" onClick={backToWork}>
          Back to work
        </button>
        {focusActive && (
          <button type="button" className="text-btn" onClick={endEarly}>
            Need a break? End session early
          </button>
        )}
      </div>
    </div>
  );
}
