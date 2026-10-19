import type { Insight, WeeklySummary } from "./schema.js";

/**
 * Anthropic Messages API client.
 *
 * Privacy: this module never logs the request summary, the API key or the
 * model response — failures surface only as a machine-readable error code.
 */

export type LlmErrorCode = "UPSTREAM_ERROR" | "BAD_MODEL_OUTPUT" | "TIMEOUT";

export class LlmError extends Error {
  readonly code: LlmErrorCode;

  constructor(code: LlmErrorCode, message?: string) {
    super(message ?? code);
    this.name = "LlmError";
    this.code = code;
  }
}

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT_MS = 20_000;

export const SYSTEM_PROMPT = [
  "You are a supportive productivity coach inside Zonify, a focus-timer Chrome extension.",
  "You receive a JSON object of aggregate weekly statistics only: no URLs, no page titles, no browsing history.",
  "Write an encouraging, specific weekly insight based strictly on those numbers.",
  "Rules:",
  "- Reference the actual numbers (minutes, sessions, streak, blocked attempts) — be concrete, not generic.",
  "- Never invent or estimate data that is not in the JSON.",
  "- If previousWeekFocusMinutes is not null, compare this week against it.",
  '- Respond with ONLY raw JSON, no markdown fences, exactly: {"headline": "...", "highlights": ["...", "..."], "suggestion": "..."}',
  "- headline: at most 8 words.",
  "- highlights: 2 to 3 short bullet strings.",
  "- suggestion: one actionable tip, at most 25 words.",
].join("\n");

export interface LlmOptions {
  model: string;
  apiKey: string | undefined;
  mock: boolean;
  timeoutMs?: number;
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/** Strip markdown fences (and surrounding prose) and parse the JSON object. */
function extractJson(raw: string): unknown {
  let text = raw.trim();

  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence && fence[1]) text = fence[1].trim();

  try {
    return JSON.parse(text);
  } catch {
    // Fall back to the outermost {...} in case the model added prose.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    return JSON.parse(text.slice(start, end + 1));
  }
}

/**
 * Validate and sanitize raw model output into an Insight.
 * Returns null on anything unexpected — the caller maps that to
 * BAD_MODEL_OUTPUT (502). Exported for unit tests.
 */
export function parseInsight(raw: string): Insight | null {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  const { headline, highlights, suggestion } = candidate;

  if (typeof headline !== "string" || headline.trim() === "") return null;
  if (typeof suggestion !== "string" || suggestion.trim() === "") return null;
  if (!Array.isArray(highlights)) return null;
  if (highlights.length < 2 || highlights.length > 3) return null;
  if (!highlights.every((h): h is string => typeof h === "string" && h.trim() !== "")) {
    return null;
  }

  return {
    headline: headline.trim().slice(0, 120),
    highlights: highlights.map((h) => h.trim().slice(0, 200)),
    suggestion: suggestion.trim().slice(0, 200),
  };
}

/** Canned insight for MOCK_LLM=true — built from the numbers, no network. */
export function mockInsight(summary: WeeklySummary): Insight {
  const hours = Math.round((summary.totalFocusMinutes / 60) * 10) / 10;
  const delta =
    summary.previousWeekFocusMinutes === null
      ? null
      : summary.totalFocusMinutes - summary.previousWeekFocusMinutes;
  const top = summary.topBlockedDomains[0];

  const highlights = [
    `${summary.sessionsCompleted} sessions completed, ${summary.sessionsStartedButEndedEarly} ended early, ${summary.streakDays}-day streak.`,
  ];
  if (delta === null) {
    highlights.push(`${hours}h of focused time this week.`);
  } else if (delta >= 0) {
    highlights.push(`Up ${delta} minutes versus last week — nice momentum.`);
  } else {
    highlights.push(`Down ${Math.abs(delta)} minutes versus last week.`);
  }
  if (top) {
    highlights.push(
      `Most blocked: ${top.domain} with ${top.attempts} blocked attempts.`,
    );
  }

  return {
    headline: `${hours} ${hours === 1 ? "hour" : "hours"} of focus this week`.slice(0, 120),
    highlights: highlights.slice(0, 3).map((h) => h.slice(0, 200)),
    suggestion: `Pick your top blocked site and schedule one 25-minute focus block for it tomorrow.`.slice(
      0,
      200,
    ),
  };
}

/**
 * Generate the weekly insight. Throws LlmError with a code the route maps
 * to a status: UPSTREAM_ERROR → 502, BAD_MODEL_OUTPUT → 502, TIMEOUT → 504.
 */
export async function generateInsight(
  summary: WeeklySummary,
  options: LlmOptions,
): Promise<Insight> {
  if (options.mock) return mockInsight(summary);

  const apiKey = options.apiKey;
  if (!apiKey) {
    // Unreachable when config validated at startup; defensive anyway.
    throw new LlmError("UPSTREAM_ERROR", "missing API key");
  }

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(summary) }],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof LlmError) throw error;
    throw new LlmError(isTimeout(error) ? "TIMEOUT" : "UPSTREAM_ERROR");
  }

  if (!response.ok) throw new LlmError("UPSTREAM_ERROR");

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LlmError("UPSTREAM_ERROR");
  }

  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new LlmError("BAD_MODEL_OUTPUT");

  const text = content
    .filter(
      (block): block is { type: string; text?: string } =>
        typeof block === "object" && block !== null,
    )
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("");

  const insight = parseInsight(text);
  if (!insight) throw new LlmError("BAD_MODEL_OUTPUT");
  return insight;
}
