/**
 * Minimal fixed-window in-memory rate limiter.
 *
 * NOTE: state lives in process memory, so limits are per-instance. If you run
 * multiple replicas, back this with Redis (see README → "Limits").
 */

export interface LimitResult {
  allowed: boolean;
  /** Seconds the client should wait before retrying (0 when allowed). */
  retryAfterSec: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface LimiterOptions {
  /** Injectable clock for tests. */
  now?: () => number;
  /** How often expired buckets are swept (ms). */
  cleanupIntervalMs?: number;
}

export function createLimiter(options: LimiterOptions = {}) {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  function sweep(): void {
    const t = now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= t) buckets.delete(key);
    }
  }

  const sweepTimer = setInterval(sweep, options.cleanupIntervalMs ?? 60_000);
  // Never keep the process alive just for cleanup.
  sweepTimer.unref?.();

  return {
    /**
     * Count one hit against `key` inside a fixed window of `windowMs`.
     * Fixed window: rejected hits do not increment and do not extend the
     * window — it always expires at `resetAt`.
     */
    hit(key: string, limit: number, windowMs: number): LimitResult {
      const t = now();
      let bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= t) {
        buckets.set(key, { count: 1, resetAt: t + windowMs });
        return { allowed: true, retryAfterSec: 0 };
      }

      if (bucket.count >= limit) {
        return {
          allowed: false,
          retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - t) / 1000)),
        };
      }

      bucket.count += 1;
      return { allowed: true, retryAfterSec: 0 };
    },

    /** Test helper: drop all state. */
    reset(): void {
      buckets.clear();
    },

    /** Number of live (non-expired) buckets. */
    size(): number {
      sweep();
      return buckets.size;
    },
  };
}

export type Limiter = ReturnType<typeof createLimiter>;
