/**
 * Client for the Zonify backend (`POST /v1/insights`), plus human-readable
 * error mapping. Nothing here touches storage — callers pass the install ID
 * and summary, which keeps every mapping function unit-testable.
 */
import type { InsightSummary } from './insights';

export interface Insight {
  headline: string;
  highlights: string[];
  suggestion: string;
}

/** Every way the request can fail, from the user's point of view. */
export type InsightFailure =
  | 'offline'
  | 'timeout'
  | 'not-enough-data'
  | 'daily-limit'
  | 'rate-limited'
  | 'service-busy'
  | 'origin'
  | 'invalid'
  | 'upstream'
  | 'unknown';

export class InsightError extends Error {
  readonly failure: InsightFailure;
  readonly retryAfterSec: number | null;

  constructor(failure: InsightFailure, message: string, retryAfterSec: number | null = null) {
    super(message);
    this.name = 'InsightError';
    this.failure = failure;
    this.retryAfterSec = retryAfterSec;
  }
}

/** Output limits mirror the backend's parseInsight(). */
const HEADLINE_MAX = 120;
const BULLET_MAX = 200;

const DEFAULT_TIMEOUT_MS = 25_000;
const HEALTH_TIMEOUT_MS = 8_000;

/**
 * Accept an http(s) origin (with an optional path prefix, e.g. behind a
 * reverse proxy). Returns the normalized base URL, or null when unusable.
 */
export function normalizeApiUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.search || url.hash) return null;

  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

function errorCodeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const code = (body as { error?: unknown }).error;
  return typeof code === 'string' ? code : null;
}

function retryAfterOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as { retryAfterSec?: unknown }).retryAfterSec;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

/** Map an HTTP status + error body onto a failure kind. */
export function classifyFailure(
  status: number,
  body: unknown,
): { failure: InsightFailure; retryAfterSec: number | null } {
  const code = errorCodeOf(body);
  const retryAfterSec = retryAfterOf(body);

  if (status === 429) {
    if (code === 'DAILY_LIMIT') return { failure: 'daily-limit', retryAfterSec };
    if (code === 'SERVICE_BUSY') return { failure: 'service-busy', retryAfterSec };
    return { failure: 'rate-limited', retryAfterSec };
  }
  if (status === 403) return { failure: 'origin', retryAfterSec };
  if (status === 422) return { failure: 'not-enough-data', retryAfterSec };
  if (status === 504) return { failure: 'timeout', retryAfterSec };
  if (status === 502) return { failure: 'upstream', retryAfterSec };
  if (status === 400 || status === 413) return { failure: 'invalid', retryAfterSec };
  return { failure: 'unknown', retryAfterSec };
}

function formatWait(retryAfterSec: number): string {
  if (retryAfterSec < 3600) return `in about ${Math.max(1, Math.round(retryAfterSec / 60))} min`;
  return `in about ${Math.max(1, Math.round(retryAfterSec / 3600))} h`;
}

/** Friendly, non-technical copy for each failure kind. */
export function describeFailure(
  failure: InsightFailure,
  retryAfterSec: number | null = null,
): string {
  const wait = retryAfterSec !== null && retryAfterSec > 0 ? ` Try again ${formatWait(retryAfterSec)}.` : '';
  switch (failure) {
    case 'offline':
      return "Can't reach the insight server. Check that it's running and the URL in the Timer tab is right.";
    case 'timeout':
      return 'The insight server took too long to answer. Try again in a moment.';
    case 'not-enough-data':
      return 'Finish at least 3 focus sessions this week to unlock an insight.';
    case 'daily-limit':
      return `You've used all of this install's insights for today.${wait || ' A new one unlocks tomorrow.'}`;
    case 'rate-limited':
      return `Too many requests from this network.${wait || ' Try again soon.'}`;
    case 'service-busy':
      return `The insight service is at capacity right now.${wait || ' Try again later.'}`;
    case 'origin':
      return "This server doesn't allow the extension's origin. Add chrome-extension://<extension-id> to its ALLOWED_ORIGINS.";
    case 'invalid':
      return 'The server rejected the request. If this keeps happening, the stats payload is out of sync with the server.';
    case 'upstream':
      return "Couldn't write an insight right now. Try again in a moment.";
    default:
      return 'Something went wrong talking to the insight server.';
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Validate the response shape defensively and clamp to the documented limits. */
export function readInsight(body: unknown): Insight | null {
  if (typeof body !== 'object' || body === null) return null;
  const candidate = (body as { insight?: unknown }).insight;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return null;

  const { headline, highlights, suggestion } = candidate as Record<string, unknown>;
  if (typeof headline !== 'string' || headline.trim() === '') return null;
  if (typeof suggestion !== 'string' || suggestion.trim() === '') return null;
  if (!Array.isArray(highlights)) return null;
  if (highlights.length < 2 || highlights.length > 3) return null;
  if (!highlights.every((item): item is string => typeof item === 'string' && item.trim() !== '')) {
    return null;
  }

  return {
    headline: headline.trim().slice(0, HEADLINE_MAX),
    highlights: highlights.map((item) => item.trim().slice(0, BULLET_MAX)),
    suggestion: suggestion.trim().slice(0, BULLET_MAX),
  };
}

export interface RequestInsightOptions {
  apiUrl: string;
  installId: string;
  summary: InsightSummary;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export async function requestInsight(options: RequestInsightOptions): Promise<Insight> {
  const base = normalizeApiUrl(options.apiUrl);
  if (!base) {
    throw new InsightError('invalid', 'Enter a server URL like http://localhost:8787');
  }

  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${base}/v1/insights`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installId: options.installId, summary: options.summary }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const aborted = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new InsightError(
      aborted ? 'timeout' : 'offline',
      describeFailure(aborted ? 'timeout' : 'offline'),
    );
  }

  const body = await readJson(response);
  if (!response.ok) {
    const { failure, retryAfterSec } = classifyFailure(response.status, body);
    throw new InsightError(failure, describeFailure(failure, retryAfterSec), retryAfterSec);
  }

  const insight = readInsight(body);
  if (!insight) throw new InsightError('upstream', describeFailure('upstream'));
  return insight;
}

/** "Test connection" — a plain health probe, no stats sent. */
export async function checkHealth(
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const base = normalizeApiUrl(apiUrl);
  if (!base) return false;
  try {
    const response = await fetchImpl(`${base}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = await readJson(response);
    return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
}
