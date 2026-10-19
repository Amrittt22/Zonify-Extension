import { describe, expect, it, vi } from 'vitest';
import {
  checkHealth,
  classifyFailure,
  describeFailure,
  InsightError,
  normalizeApiUrl,
  readInsight,
  requestInsight,
  type InsightFailure,
} from '../src/lib/api';
import type { InsightSummary } from '../src/lib/insights';

const SUMMARY: InsightSummary = {
  week: 'Oct 19 - Oct 25',
  totalFocusMinutes: 85,
  sessionsCompleted: 4,
  sessionsStartedButEndedEarly: 1,
  streakDays: 3,
  minutesByDay: { Mon: 25, Tue: 25, Wed: 10, Thu: 0, Fri: 0, Sat: 0, Sun: 25 },
  minutesByHourBucket: { morning: 35, afternoon: 25, evening: 25 },
  topBlockedDomains: [{ domain: 'youtube.com', attempts: 84 }],
  previousWeekFocusMinutes: 25,
};

const INSIGHT = {
  headline: 'Steady week',
  highlights: ['85 minutes focused', '3-day streak'],
  suggestion: 'Protect your morning block.',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('normalizeApiUrl', () => {
  it('keeps http(s) origins and trims trailing slashes', () => {
    expect(normalizeApiUrl('http://localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeApiUrl(' https://api.example.com/ ')).toBe('https://api.example.com');
    expect(normalizeApiUrl('https://example.com/zonify/')).toBe('https://example.com/zonify');
  });

  it('rejects anything that is not a plain http(s) base URL', () => {
    expect(normalizeApiUrl('')).toBeNull();
    expect(normalizeApiUrl('   ')).toBeNull();
    expect(normalizeApiUrl('localhost:8787')).toBeNull();
    expect(normalizeApiUrl('chrome-extension://abc')).toBeNull();
    expect(normalizeApiUrl('ftp://example.com')).toBeNull();
    expect(normalizeApiUrl('https://example.com/?x=1')).toBeNull();
    expect(normalizeApiUrl('https://example.com/#tab')).toBeNull();
  });
});

describe('classifyFailure', () => {
  const cases: Array<[number, unknown, InsightFailure]> = [
    [403, { error: 'ORIGIN_NOT_ALLOWED' }, 'origin'],
    [422, { error: 'NOT_ENOUGH_DATA' }, 'not-enough-data'],
    [429, { error: 'RATE_LIMITED' }, 'rate-limited'],
    [429, { error: 'DAILY_LIMIT' }, 'daily-limit'],
    [429, { error: 'SERVICE_BUSY' }, 'service-busy'],
    [400, { error: 'INVALID_REQUEST' }, 'invalid'],
    [400, { error: 'INVALID_JSON' }, 'invalid'],
    [413, { error: 'TOO_LARGE' }, 'invalid'],
    [502, { error: 'UPSTREAM_ERROR' }, 'upstream'],
    [502, { error: 'BAD_MODEL_OUTPUT' }, 'upstream'],
    [504, { error: 'TIMEOUT' }, 'timeout'],
    [500, { error: 'INTERNAL' }, 'unknown'],
    [418, 'nonsense', 'unknown'],
  ];

  it.each(cases)('maps %i %o to %s', (status, body, expected) => {
    expect(classifyFailure(status, body).failure).toBe(expected);
  });

  it('surfaces retryAfterSec when present', () => {
    expect(classifyFailure(429, { error: 'DAILY_LIMIT', retryAfterSec: 3600 }).retryAfterSec).toBe(3600);
    expect(classifyFailure(429, { error: 'RATE_LIMITED' }).retryAfterSec).toBeNull();
  });
});

describe('describeFailure', () => {
  const failures: InsightFailure[] = [
    'offline', 'timeout', 'not-enough-data', 'daily-limit', 'rate-limited',
    'service-busy', 'origin', 'invalid', 'upstream', 'unknown',
  ];

  it('has non-empty copy for every failure kind', () => {
    for (const failure of failures) {
      const message = describeFailure(failure, null);
      expect(message.length).toBeGreaterThan(10);
    }
  });

  it('mentions the wait when the server asks for one', () => {
    expect(describeFailure('daily-limit', 7200)).toMatch(/2 h/);
    expect(describeFailure('rate-limited', 300)).toMatch(/min/);
  });
});

describe('readInsight', () => {
  it('accepts a well-formed insight', () => {
    expect(readInsight({ insight: INSIGHT })).toEqual(INSIGHT);
  });

  it('rejects malformed payloads', () => {
    expect(readInsight(null)).toBeNull();
    expect(readInsight({})).toBeNull();
    expect(readInsight({ insight: { headline: 'only' } })).toBeNull();
    expect(readInsight({ insight: { ...INSIGHT, highlights: ['one'] } })).toBeNull();
    expect(readInsight({ insight: { ...INSIGHT, highlights: ['a', 'b', 'c', 'd'] } })).toBeNull();
    expect(readInsight({ insight: { ...INSIGHT, suggestion: '  ' } })).toBeNull();
    expect(readInsight({ insight: [] })).toBeNull();
  });

  it('clamps overlong fields to 120/200/200', () => {
    const insight = readInsight({
      insight: {
        headline: 'h'.repeat(400),
        highlights: ['a'.repeat(400), 'b'.repeat(400)],
        suggestion: 's'.repeat(400),
      },
    });
    expect(insight?.headline).toHaveLength(120);
    expect(insight?.highlights.every((line) => line.length === 200)).toBe(true);
    expect(insight?.suggestion).toHaveLength(200);
  });
});

describe('requestInsight', () => {
  it('posts the summary and returns the insight', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ insight: INSIGHT }));
    const insight = await requestInsight({
      apiUrl: 'http://localhost:8787/',
      installId: '11111111-1111-4111-8111-111111111111',
      summary: SUMMARY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(insight).toEqual(INSIGHT);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/v1/insights');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      installId: '11111111-1111-4111-8111-111111111111',
      summary: SUMMARY,
    });
  });

  it('maps a 429 DAILY_LIMIT to a friendly message with the wait', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'DAILY_LIMIT', retryAfterSec: 7200 }, 429),
    );
    await expect(
      requestInsight({
        apiUrl: 'http://localhost:8787',
        installId: 'id',
        summary: SUMMARY,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ failure: 'daily-limit', retryAfterSec: 7200 });
  });

  it('maps a 403 to the origin failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'ORIGIN_NOT_ALLOWED' }, 403));
    await expect(
      requestInsight({
        apiUrl: 'http://localhost:8787',
        installId: 'id',
        summary: SUMMARY,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ failure: 'origin' });
  });

  it('treats a network error as offline and an abort as a timeout', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      requestInsight({ apiUrl: 'http://x.test', installId: 'id', summary: SUMMARY, fetchImpl: offline as unknown as typeof fetch }),
    ).rejects.toMatchObject({ failure: 'offline' });

    const abort = new Error('aborted');
    abort.name = 'TimeoutError';
    const slow = vi.fn(async () => {
      throw abort;
    });
    await expect(
      requestInsight({ apiUrl: 'http://x.test', installId: 'id', summary: SUMMARY, fetchImpl: slow as unknown as typeof fetch }),
    ).rejects.toMatchObject({ failure: 'timeout' });
  });

  it('rejects an invalid server URL before any request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ insight: INSIGHT }));
    await expect(
      requestInsight({ apiUrl: 'not a url', installId: 'id', summary: SUMMARY, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(InsightError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a 200 with unusable output as upstream', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ insight: { headline: 'nope' } }));
    await expect(
      requestInsight({ apiUrl: 'http://localhost:8787', installId: 'id', summary: SUMMARY, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ failure: 'upstream' });
  });
});

describe('checkHealth', () => {
  it('is true only for { ok: true }', async () => {
    const ok = vi.fn(async () => jsonResponse({ ok: true }));
    const bad = vi.fn(async () => jsonResponse({ ok: false }));
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await checkHealth('http://localhost:8787', ok as unknown as typeof fetch)).toBe(true);
    expect(await checkHealth('http://localhost:8787', bad as unknown as typeof fetch)).toBe(false);
    expect(await checkHealth('http://localhost:8787', down as unknown as typeof fetch)).toBe(false);
    expect(await checkHealth('nonsense', ok as unknown as typeof fetch)).toBe(false);
  });
});
