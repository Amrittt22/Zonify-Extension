import { describe, expect, it, vi } from "vitest";
import {
  generateInsight,
  LlmError,
  mockInsight,
  parseInsight,
} from "../src/llm.js";
import type { WeeklySummary } from "../src/schema.js";

const summary: WeeklySummary = {
  week: "Oct 13 - Oct 19",
  totalFocusMinutes: 720,
  sessionsCompleted: 14,
  sessionsStartedButEndedEarly: 3,
  streakDays: 6,
  minutesByDay: { Mon: 90, Tue: 120, Wed: 60, Thu: 110, Fri: 140, Sat: 130, Sun: 70 },
  minutesByHourBucket: { morning: 260, afternoon: 300, evening: 160 },
  topBlockedDomains: [{ domain: "youtube.com", attempts: 84 }],
  previousWeekFocusMinutes: 540,
};

describe("parseInsight", () => {
  const valid = {
    headline: "A strong week",
    highlights: ["14 sessions done", "Up 180 minutes"],
    suggestion: "Keep the morning slot.",
  };

  it("parses plain JSON", () => {
    expect(parseInsight(JSON.stringify(valid))).toEqual(valid);
  });

  it("parses JSON wrapped in a markdown code fence", () => {
    const raw = "```json\n" + JSON.stringify(valid) + "\n```";
    expect(parseInsight(raw)).toEqual(valid);
  });

  it("parses JSON surrounded by prose", () => {
    const raw = "Sure! Here it is: " + JSON.stringify(valid) + " Enjoy!";
    expect(parseInsight(raw)).toEqual(valid);
  });

  it("rejects non-JSON garbage", () => {
    expect(parseInsight("I could not produce an insight today.")).toBeNull();
  });

  it("rejects wrong shapes", () => {
    expect(parseInsight('{"headline":"only"}')).toBeNull();
    expect(parseInsight("[]")).toBeNull();
    expect(parseInsight('"just a string"')).toBeNull();
    expect(
      parseInsight(
        JSON.stringify({ ...valid, highlights: ["only one bullet"] }),
      ),
    ).toBeNull();
    expect(
      parseInsight(
        JSON.stringify({ ...valid, highlights: ["a", "b", "c", "d"] }),
      ),
    ).toBeNull();
    expect(parseInsight(JSON.stringify({ ...valid, headline: "   " }))).toBeNull();
  });

  it("trims overlong fields to 120/200/200", () => {
    const raw = JSON.stringify({
      headline: "h".repeat(300),
      highlights: ["a".repeat(500), "b".repeat(500)],
      suggestion: "s".repeat(500),
    });
    const insight = parseInsight(raw);
    expect(insight?.headline).toHaveLength(120);
    expect(insight?.highlights.every((h) => h.length === 200)).toBe(true);
    expect(insight?.suggestion).toHaveLength(200);
  });
});

describe("mockInsight", () => {
  it("builds an insight from the summary numbers", () => {
    const insight = mockInsight(summary);
    expect(insight.headline.length).toBeGreaterThan(0);
    expect(insight.highlights.length).toBeGreaterThanOrEqual(2);
    expect(insight.highlights.length).toBeLessThanOrEqual(3);
    expect(insight.highlights.join(" ")).toContain("14 sessions completed");
    expect(insight.highlights.join(" ")).toContain("180 minutes");
    expect(insight.highlights.join(" ")).toContain("youtube.com");
    expect(insight.suggestion.length).toBeLessThanOrEqual(200);
  });

  it("handles a null previous week", () => {
    const insight = mockInsight({ ...summary, previousWeekFocusMinutes: null });
    expect(insight.highlights.join(" ")).not.toContain("versus last week");
  });

  it("uses the singular 'hour' for a one-hour week", () => {
    const insight = mockInsight({
      ...summary,
      totalFocusMinutes: 60,
      previousWeekFocusMinutes: null,
    });
    expect(insight.headline).toContain("1 hour of focus");
  });
});

describe("generateInsight", () => {
  it("returns a mock insight without network access when mock=true", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const insight = await generateInsight(summary, {
      model: "claude-haiku-5-5",
      apiKey: undefined,
      mock: true,
    });
    expect(insight.headline.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("throws TIMEOUT when the provider aborts", async () => {
    const timeout = new Error("operation aborted");
    timeout.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(timeout);
    await expect(
      generateInsight(summary, { model: "m", apiKey: "k", mock: false }),
    ).rejects.toMatchObject({ code: "TIMEOUT" satisfies LlmError["code"] });
  });

  it("throws UPSTREAM_ERROR on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 429 }),
    );
    await expect(
      generateInsight(summary, { model: "m", apiKey: "k", mock: false }),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("throws BAD_MODEL_OUTPUT on unusable output", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "not json" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      generateInsight(summary, { model: "m", apiKey: "k", mock: false }),
    ).rejects.toMatchObject({ code: "BAD_MODEL_OUTPUT" });
  });

  it("parses a good provider response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                headline: "Solid week",
                highlights: ["12h focused", "6-day streak"],
                suggestion: "Protect your morning block.",
              }),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const insight = await generateInsight(summary, {
      model: "m",
      apiKey: "k",
      mock: false,
    });
    expect(insight.headline).toBe("Solid week");
    vi.restoreAllMocks();
  });
});
