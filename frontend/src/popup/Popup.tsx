import { useState } from 'react';
import { GearIcon, RingDotLogo } from '../components/icons';
import { useStorageValue, useTick } from '../lib/hooks';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TIMER_STATE,
  STORAGE_KEYS,
} from '../lib/storage';
import {
  durationForMode,
  formatClock,
  formatDuration,
  isActiveSession,
  isBreakMode,
  isSameLocalDay,
} from '../lib/timer';
import type { ActiveMode, Settings, SessionEntry, TimerMessage, TimerState } from '../lib/types';

type PopupMode = ActiveMode;

const RING_RADIUS = 94;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function Popup() {
  const timerState = useStorageValue<TimerState>(STORAGE_KEYS.timerState, DEFAULT_TIMER_STATE);
  const settings = useStorageValue<Settings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS, (stored) => ({
    ...DEFAULT_SETTINGS,
    ...stored,
  }));
  const blocklist = useStorageValue<string[]>(STORAGE_KEYS.blocklist, []);
  const sessions = useStorageValue<SessionEntry[]>(STORAGE_KEYS.sessions, []);

  const now = useTick(250);
  const [selected, setSelected] = useState<PopupMode>('focus');

  const active = isActiveSession(timerState);
  // While a session exists, tabs mirror it; when idle the user's pick drives it.
  const viewMode: PopupMode = active && timerState.mode !== 'idle' ? timerState.mode : selected;
  const isBreakView = isBreakMode(viewMode);

  // Countdown: derive from endsAt / remainingMs / settings — never memory.
  const totalMs = durationForMode(settings, viewMode);
  let remainingMs: number;
  if (active && timerState.isRunning && timerState.endsAt !== null) {
    remainingMs = Math.max(0, timerState.endsAt - now);
  } else if (active && !timerState.isRunning && timerState.remainingMs !== null && timerState.mode === viewMode) {
    remainingMs = timerState.remainingMs;
  } else {
    remainingMs = totalMs;
  }
  const progress = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  const offset = CIRCUMFERENCE * (1 - progress);

  const todayFocusMs = sessions
    .filter((s) => s.mode === 'focus' && isSameLocalDay(s.endedAt, now))
    .reduce((sum, s) => sum + s.durationMs, 0);

  const tabs: Array<{ id: PopupMode; label: string; break?: boolean }> = [
    { id: 'focus', label: 'Focus' },
    { id: 'short', label: 'Short break', break: true },
    { id: 'long', label: 'Long break', break: true },
  ];

  const send = (message: TimerMessage) => {
    chrome.runtime.sendMessage(message).catch(() => {
      /* worker unavailable — UI already reflects storage */
    });
  };

  const openSettings = () => {
    chrome.runtime
      .openOptionsPage()
      .catch(() => {});
  };

  // Primary / secondary controls per state.
  const focusRunning = active && timerState.isRunning && timerState.mode === 'focus';
  const focusPaused = active && !timerState.isRunning && timerState.mode === 'focus';

  let primary: { label: string; variant: 'focus' | 'break'; onClick: () => void };
  if (focusRunning) {
    primary = { label: 'Pause', variant: 'focus', onClick: () => send({ type: 'PAUSE' }) };
  } else if (focusPaused) {
    primary = { label: 'Resume', variant: 'focus', onClick: () => send({ type: 'RESUME' }) };
  } else if (isBreakView) {
    const breakIsRunning = active && timerState.isRunning && isBreakMode(timerState.mode);
    primary = breakIsRunning
      ? { label: 'Start focus', variant: 'break', onClick: () => send({ type: 'START', mode: 'focus' }) }
      : { label: 'Start break', variant: 'break', onClick: () => send({ type: 'START', mode: viewMode }) };
  } else {
    primary = { label: 'Start focus', variant: 'focus', onClick: () => send({ type: 'START', mode: 'focus' }) };
  }

  const secondary = isBreakView
    ? {
        label: '+1 min',
        disabled: false,
        onClick: () => send({ type: 'EXTEND_BREAK' }),
      }
    : {
        label: 'Reset',
        disabled: !active,
        onClick: () => send({ type: 'RESET' }),
      };

  const subtext = isBreakView
    ? viewMode === 'short'
      ? 'Short break'
      : 'Long break'
    : `Session ${timerState.sessionIndex} of ${settings.sessionsBeforeLong}`;

  const clockLabel = `${Math.floor(remainingMs / 60000)} minutes ${Math.floor(
    (remainingMs % 60000) / 1000,
  )} seconds remaining`;

  return (
    <div className="popup">
      <header className="popup__header">
        <span className="popup__logo">
          <RingDotLogo size={26} title="Zonify" />
        </span>
        <span className="popup__title">Zonify</span>
        <button type="button" className="icon-btn" aria-label="Open settings" onClick={openSettings}>
          <GearIcon />
        </button>
      </header>

      <nav className="popup__tabs" role="tablist" aria-label="Timer mode">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`popup-tab-${tab.id}`}
            type="button"
            role="tab"
            className="pill"
            data-variant={tab.break ? 'break' : 'focus'}
            aria-selected={viewMode === tab.id}
            aria-controls="popup-timer-panel"
            aria-disabled={active}
            onClick={() => {
              if (!active) setSelected(tab.id);
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div
        className="ring-wrap"
        id="popup-timer-panel"
        role="tabpanel"
        aria-labelledby={`popup-tab-${viewMode}`}
      >
        <svg
          className="ring-wrap__svg"
          width="208"
          height="208"
          viewBox="0 0 208 208"
          aria-hidden="true"
        >
          <circle
            className="ring-track"
            cx="104"
            cy="104"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="14"
          />
          <circle
            className="ring-progress"
            data-variant={isBreakView ? 'break' : 'focus'}
            cx="104"
            cy="104"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform="rotate(-90 104 104)"
          />
        </svg>
        <div className="ring-center" role="timer" aria-label={clockLabel}>
          <div className="ring-center__time">{formatClock(remainingMs)}</div>
          <div className="ring-center__sub">{subtext}</div>
        </div>
      </div>

      <div className="popup__controls">
        <button
          type="button"
          className={`btn ${primary.variant === 'break' ? 'btn--break' : 'btn--primary'}`}
          onClick={primary.onClick}
        >
          {primary.label}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={secondary.disabled}
          onClick={secondary.onClick}
        >
          {secondary.label}
        </button>
      </div>

      <footer className={`popup__footer ${isBreakView ? 'popup__footer--break' : ''}`}>
        {isBreakView ? (
          <>
            <span className="popup__footer-left">Look away from the screen for 20s</span>
            <span className="popup__footer-right tabular">Next: session {timerState.sessionIndex}</span>
          </>
        ) : (
          <>
            <span className="popup__footer-left">
              Blocking {blocklist.length} site{blocklist.length === 1 ? '' : 's'}
            </span>
            <span className="popup__footer-right tabular">
              {formatDuration(todayFocusMs)} focused today
            </span>
          </>
        )}
      </footer>
    </div>
  );
}
