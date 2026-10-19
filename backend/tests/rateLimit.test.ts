import { describe, expect, it } from "vitest";
import { createLimiter } from "../src/rateLimit.js";

describe("createLimiter", () => {
  it("allows up to the limit, then blocks", () => {
    const limiter = createLimiter();
    expect(limiter.hit("k", 3, 60_000).allowed).toBe(true);
    expect(limiter.hit("k", 3, 60_000).allowed).toBe(true);
    expect(limiter.hit("k", 3, 60_000).allowed).toBe(true);
    const blocked = limiter.hit("k", 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("keeps keys independent", () => {
    const limiter = createLimiter();
    expect(limiter.hit("a", 1, 60_000).allowed).toBe(true);
    expect(limiter.hit("b", 1, 60_000).allowed).toBe(true);
    expect(limiter.hit("a", 1, 60_000).allowed).toBe(false);
  });

  it("opens the window again after expiry (injectable clock)", () => {
    let clock = 1_000_000;
    const limiter = createLimiter({ now: () => clock });
    expect(limiter.hit("k", 1, 10_000).allowed).toBe(true);
    expect(limiter.hit("k", 1, 10_000).allowed).toBe(false);
    clock += 10_001;
    expect(limiter.hit("k", 1, 10_000).allowed).toBe(true);
  });

  it("reports a sensible retryAfterSec", () => {
    let clock = 1_000_000;
    const limiter = createLimiter({ now: () => clock });
    limiter.hit("k", 1, 30_000);
    clock += 12_000;
    const blocked = limiter.hit("k", 1, 30_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(18);
  });

  it("sweeps expired buckets", () => {
    let clock = 1_000_000;
    const limiter = createLimiter({
      now: () => clock,
      cleanupIntervalMs: 60_000,
    });
    limiter.hit("k", 5, 1_000);
    expect(limiter.size()).toBe(1);
    clock += 5_000;
    expect(limiter.size()).toBe(0);
    limiter.reset();
    expect(limiter.size()).toBe(0);
  });
});
