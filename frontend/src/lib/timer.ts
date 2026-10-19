/** Timer state-machine helpers + shared formatters (pure functions). */
import type { Mode, Settings, TimerState } from './types';

/** Duration of a mode in ms (0 for idle). */
export function durationForMode(settings: Settings, mode: Mode): number {
  switch (mode) {
    case 'focus':
      return settings.focus * 60_000;
    case 'short':
      return settings.short * 60_000;
    case 'long':
      return settings.long * 60_000;
    default:
      return 0;
  }
}

export function isBreakMode(mode: Mode): mode is 'short' | 'long' {
  return mode === 'short' || mode === 'long';
}

/** A session exists that the UI should count down (running or paused). */
export function isActiveSession(state: TimerState): boolean {
  return state.mode !== 'idle' && (state.isRunning || state.remainingMs !== null);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** "24:37" — seconds are rounded up so 00:00 only shows at the real end. */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** "2h 05m", "45m", "0m" — human duration for stat/footer text. */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

/** Local-time day identity (YYYY-MM-DD) — stats use local dates, never UTC. */
export function localDayKey(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function startOfLocalDay(time: number): number {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Do two timestamps fall on the same local calendar day? */
export function isSameLocalDay(a: number, b: number): boolean {
  return localDayKey(a) === localDayKey(b);
}
