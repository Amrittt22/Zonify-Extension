/** Small React hooks shared by popup, options and blocked pages. */
import { useEffect, useState } from 'react';

/**
 * Subscribe to one chrome.storage.local key. Returns `initial` until loaded
 * and re-renders whenever the key changes (from any page or the worker).
 */
export function useStorageValue<T>(key: string, initial: T, merge?: (stored: Partial<T>) => T): T {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    // Outside an extension context (e.g. plain-browser preview), keep defaults.
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    let alive = true;

    chrome.storage.local
      .get(key)
      .then((result) => {
        const stored = result[key] as T | undefined;
        if (alive && stored !== undefined) {
          setValue(merge ? merge(stored as Partial<T>) : stored);
        }
      })
      .catch(() => {
        /* storage unavailable — keep defaults */
      });

    const onChange = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (!alive || area !== 'local') return;
      const change = changes[key];
      if (!change) return;
      const next = change.newValue as T | undefined;
      if (next === undefined) setValue(initial);
      else setValue(merge ? merge(next as Partial<T>) : next);
    };

    chrome.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
    // `initial`/`merge` are intentionally not deps: key identity is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return value;
}

/** Re-render on an interval (countdowns). */
export function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
