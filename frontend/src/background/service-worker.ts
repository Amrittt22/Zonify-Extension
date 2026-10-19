/**
 * Zonify service worker — the single source of truth for timer + blocking.
 *
 * Architecture rules:
 * - All state lives in chrome.storage.local; MV3 workers sleep, so nothing
 *   timer-related is kept in memory. Time left is always endsAt - Date.now().
 * - All listeners are registered at the top level of this file.
 * - Every mutation goes through a serial queue and ends in reconcile(), which
 *   makes alarms, DNR rules and the badge match the stored state. reconcile()
 *   is idempotent and also ends a session exactly once if its end was missed
 *   (laptop sleep, browser restart, duplicate/early alarms).
 */
import iconUrl from '../assets/icons/icon48.png';
import { syncRules } from '../lib/rules';
import { appendSession, getBlocklist, getSettings, getTimerState, setTimerState } from '../lib/storage';
import { durationForMode, isBreakMode, isActiveSession } from '../lib/timer';
import {
  ALARM_BADGE_TICK,
  ALARM_SESSION_END,
  NOTIFICATION_BREAK_END,
  NOTIFICATION_FOCUS_END,
} from '../lib/types';
import type { ActiveMode, Settings, TimerMessage, TimerState } from '../lib/types';

// ---------------------------------------------------------------------------
// Serial queue — every state mutation runs here, never concurrently.
// ---------------------------------------------------------------------------
let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch((err) => console.error('Zonify: task failed', err));
  return queue;
}

const TIMER_MESSAGE_TYPES = [
  'START',
  'PAUSE',
  'RESUME',
  'RESET',
  'SKIP',
  'EXTEND_BREAK',
  'END_EARLY',
] as const;

function isTimerMessage(value: unknown): value is TimerMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    TIMER_MESSAGE_TYPES.includes((value as { type: string }).type as (typeof TIMER_MESSAGE_TYPES)[number])
  );
}

// ---------------------------------------------------------------------------
// Reconcile — alarms + badge + rules always match stored state.
// ---------------------------------------------------------------------------
async function reconcile(): Promise<void> {
  let state = await getTimerState();
  const settings = await getSettings();
  const blocklist = await getBlocklist();
  let now = Date.now();

  // Missed session end (sleep / restart / late alarm): end it exactly once.
  if (state.isRunning && state.endsAt !== null && now >= state.endsAt) {
    state = await completeSession(state, settings, true);
    now = Date.now();
  }

  // One-shot alarm for the running session; cleared otherwise.
  if (state.isRunning && state.endsAt !== null) {
    const existing = await chrome.alarms.get(ALARM_SESSION_END);
    if (!existing || Math.abs((existing.scheduledTime ?? 0) - state.endsAt) > 1000) {
      await chrome.alarms.clear(ALARM_SESSION_END);
      chrome.alarms.create(ALARM_SESSION_END, { when: state.endsAt });
    }
  } else if (await chrome.alarms.get(ALARM_SESSION_END)) {
    await chrome.alarms.clear(ALARM_SESSION_END);
  }

  // Repeating 1-minute alarm that refreshes the badge text.
  if (!(await chrome.alarms.get(ALARM_BADGE_TICK))) {
    chrome.alarms.create(ALARM_BADGE_TICK, { periodInMinutes: 1 });
  }

  await syncRules(state, blocklist);
  await updateBadge(state, Date.now());
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
async function updateBadge(state: TimerState, now: number): Promise<void> {
  if (state.isRunning && state.endsAt !== null) {
    const minutes = Math.max(1, Math.ceil((state.endsAt - now) / 60_000));
    await chrome.action.setBadgeText({ text: String(minutes) });
    await chrome.action.setBadgeBackgroundColor({
      color: state.mode === 'focus' ? '#5EEAD4' : '#A5B4FC',
    });
    await chrome.action.setBadgeTextColor({ color: '#06222A' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

// ---------------------------------------------------------------------------
// Notifications (system sound is suppressed when the sound setting is off)
// ---------------------------------------------------------------------------
async function notifyFocusEnd(settings: Settings, breakMode: 'short' | 'long'): Promise<void> {
  if (!settings.notifications) return;
  try {
    await chrome.notifications.clear(NOTIFICATION_BREAK_END);
    await chrome.notifications.create(NOTIFICATION_FOCUS_END, {
      type: 'basic',
      iconUrl,
      title: 'Focus session complete',
      message: `Nice work. Take a ${settings[breakMode]} minute break.`,
      silent: !settings.sound,
      buttons: [{ title: 'Start break' }, { title: 'Skip' }],
    });
  } catch (err) {
    console.error('Zonify: notification failed', err);
  }
}

async function notifyBreakEnd(settings: Settings, autoStarted: boolean): Promise<void> {
  if (!settings.notifications) return;
  try {
    await chrome.notifications.clear(NOTIFICATION_FOCUS_END);
    const focusMin = settings.focus;
    await chrome.notifications.create(NOTIFICATION_BREAK_END, {
      type: 'basic',
      iconUrl,
      title: 'Break over. Ready to focus?',
      message: autoStarted
        ? `Starting a ${focusMin} minute focus session now.`
        : `${focusMin} minutes of focus when you're ready.`,
      silent: !settings.sound,
      ...(autoStarted ? {} : { buttons: [{ title: 'Start focus' }] }),
    });
  } catch (err) {
    console.error('Zonify: notification failed', err);
  }
}

// ---------------------------------------------------------------------------
// Session transitions
// ---------------------------------------------------------------------------

/**
 * Finish the current session: log it, advance the state machine, notify.
 * `normalEnd` = alarm/timeout fired; otherwise (SKIP/END_EARLY) log only the
 * time actually spent. Persists the new state and returns it.
 */
async function completeSession(
  state: TimerState,
  settings: Settings,
  normalEnd: boolean,
): Promise<TimerState> {
  const now = Date.now();
  const totalMs = durationForMode(settings, state.mode);
  const remaining =
    state.isRunning && state.endsAt !== null
      ? Math.max(0, state.endsAt - now)
      : (state.remainingMs ?? totalMs);
  const durationMs = normalEnd ? totalMs : Math.max(0, totalMs - remaining);

  if (!isBreakMode(state.mode)) {
    // ---- focus session finished -> break ----
    await appendSession({ endedAt: now, durationMs, mode: 'focus', endedEarly: !normalEnd });

    const finishedIndex = state.sessionIndex;
    const cycle = Math.max(1, settings.sessionsBeforeLong);
    const isLong = finishedIndex >= cycle;
    const breakMode: ActiveMode = isLong ? 'long' : 'short';

    const next: TimerState = {
      mode: breakMode,
      endsAt: settings.autoStartBreaks ? now + durationForMode(settings, breakMode) : null,
      remainingMs: null,
      isRunning: settings.autoStartBreaks,
      completedSessions: state.completedSessions + 1,
      sessionIndex: isLong ? 1 : finishedIndex + 1,
    };
    await setTimerState(next);
    await notifyFocusEnd(settings, breakMode);
    return next;
  }

  // ---- break finished -> idle or auto-started focus ----
  await appendSession({ endedAt: now, durationMs, mode: state.mode });

  const next: TimerState = settings.autoStartFocus
    ? {
        mode: 'focus',
        endsAt: now + durationForMode(settings, 'focus'),
        remainingMs: null,
        isRunning: true,
        completedSessions: state.completedSessions,
        sessionIndex: state.sessionIndex,
      }
    : {
        mode: 'idle',
        endsAt: null,
        remainingMs: null,
        isRunning: false,
        completedSessions: state.completedSessions,
        sessionIndex: state.sessionIndex,
      };
  await setTimerState(next);
  await notifyBreakEnd(settings, next.isRunning);
  return next;
}

async function doStart(mode?: ActiveMode): Promise<void> {
  const state = await getTimerState();
  const settings = await getSettings();
  const target: ActiveMode = mode ?? (isBreakMode(state.mode) ? state.mode : 'focus');
  if (state.isRunning && state.mode === target && state.endsAt !== null) return; // already running

  await setTimerState({
    ...state,
    mode: target,
    endsAt: Date.now() + durationForMode(settings, target),
    remainingMs: null,
    isRunning: true,
  });
  await reconcile();
}

async function doPause(): Promise<void> {
  const state = await getTimerState();
  if (!state.isRunning || state.endsAt === null) return;
  const remainingMs = Math.max(0, state.endsAt - Date.now());
  await setTimerState({ ...state, endsAt: null, remainingMs, isRunning: false });
  await reconcile();
}

async function doResume(): Promise<void> {
  const state = await getTimerState();
  if (state.isRunning || state.mode === 'idle' || state.remainingMs === null) return;
  await setTimerState({
    ...state,
    endsAt: Date.now() + state.remainingMs,
    remainingMs: null,
    isRunning: true,
  });
  await reconcile();
}

async function doReset(): Promise<void> {
  const state = await getTimerState();
  if (!isActiveSession(state)) return;
  await setTimerState({ ...state, mode: 'idle', endsAt: null, remainingMs: null, isRunning: false });
  await reconcile();
}

async function doSkip(): Promise<void> {
  const state = await getTimerState();
  const settings = await getSettings();
  if (isBreakMode(state.mode)) {
    // Skip the break -> straight into focus (notification "Skip" button).
    await doStart('focus');
    return;
  }
  if (state.mode === 'focus' && isActiveSession(state)) {
    await completeSession(state, settings, false);
    await reconcile();
    return;
  }
  await doStart('focus');
}

async function doEndEarly(): Promise<void> {
  const state = await getTimerState();
  const settings = await getSettings();
  if (state.mode === 'focus' && isActiveSession(state)) {
    await completeSession(state, settings, false);
  } else if (isBreakMode(state.mode) && isActiveSession(state)) {
    await setTimerState({ ...state, mode: 'idle', endsAt: null, remainingMs: null, isRunning: false });
  } else {
    return;
  }
  await reconcile();
}

async function doExtendBreak(): Promise<void> {
  const state = await getTimerState();
  if (!isBreakMode(state.mode)) return;
  const settings = await getSettings();
  if (state.isRunning && state.endsAt !== null) {
    await setTimerState({ ...state, endsAt: state.endsAt + 60_000 });
  } else {
    // Break not running yet: start it with one extra minute.
    await setTimerState({
      ...state,
      endsAt: Date.now() + durationForMode(settings, state.mode) + 60_000,
      remainingMs: null,
      isRunning: true,
    });
  }
  await reconcile();
}

async function handleMessage(message: TimerMessage): Promise<void> {
  switch (message.type) {
    case 'START':
      return doStart(message.mode);
    case 'PAUSE':
      return doPause();
    case 'RESUME':
      return doResume();
    case 'RESET':
      return doReset();
    case 'SKIP':
      return doSkip();
    case 'EXTEND_BREAK':
      return doExtendBreak();
    case 'END_EARLY':
      return doEndEarly();
  }
}

// ---------------------------------------------------------------------------
// Top-level listeners (registered synchronously — MV3 requirement)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isTimerMessage(message)) return false;
  void enqueue(async () => {
    try {
      await handleMessage(message);
      sendResponse({ ok: true });
    } catch (err) {
      console.error('Zonify: message failed', err);
      sendResponse({ ok: false });
    }
  });
  return true; // async response
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SESSION_END) {
    void enqueue(async () => {
      const state = await getTimerState();
      const now = Date.now();
      if (!state.isRunning || state.endsAt === null) {
        await chrome.alarms.clear(ALARM_SESSION_END);
        return;
      }
      if (now < state.endsAt - 1000) {
        // Early or duplicate fire — realign to the real end time, once.
        await chrome.alarms.clear(ALARM_SESSION_END);
        chrome.alarms.create(ALARM_SESSION_END, { when: state.endsAt });
        return;
      }
      await reconcile(); // completes the session exactly once
    });
  } else if (alarm.name === ALARM_BADGE_TICK) {
    void enqueue(async () => {
      await updateBadge(await getTimerState(), Date.now());
    });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.blocklist || changes.timerState || changes.settings) {
    void enqueue(reconcile);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void enqueue(reconcile);
});

chrome.runtime.onStartup.addListener(() => {
  void enqueue(reconcile);
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  void enqueue(async () => {
    try {
      if (notificationId === NOTIFICATION_FOCUS_END) {
        if (buttonIndex === 0) {
          const state = await getTimerState();
          if (isBreakMode(state.mode)) await doStart(state.mode); // "Start break"
        } else if (buttonIndex === 1) {
          await doSkip(); // "Skip" — skip the break, start focus
        }
        await chrome.notifications.clear(notificationId);
      } else if (notificationId === NOTIFICATION_BREAK_END) {
        if (buttonIndex === 0) await doStart('focus'); // "Start focus"
        await chrome.notifications.clear(notificationId);
      }
    } catch (err) {
      console.error('Zonify: notification action failed', err);
    }
  });
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('zonify-')) {
    void Promise.resolve()
      .then(() => chrome.runtime.openOptionsPage())
      .catch(() => {
        /* options page unavailable */
      });
  }
});

// Runs on every worker start: restores alarms/rules/badge after restarts.
void enqueue(reconcile);
