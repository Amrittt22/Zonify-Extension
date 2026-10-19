import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  insightsRequestSchema,
  toIssues,
  type InsightsRequest,
} from "../src/schema.js";

const sample: InsightsRequest = JSON.parse(
  readFileSync(new URL("../sample.json", import.meta.url), "utf8"),
);

function clone(): InsightsRequest {
  return structuredClone(sample);
}

describe("insightsRequestSchema", () => {
  it("accepts the valid sample payload", () => {
    const result = insightsRequestSchema.safeParse(sample);
    expect(result.success).toBe(true);
  });

  it("rejects extra top-level fields (strict)", () => {
    const body = { ...clone(), pageUrl: "https://youtube.com/watch" };
    const result = insightsRequestSchema.safeParse(body);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = toIssues(result.error);
      expect(issues[0]?.path).toBe("");
      expect(issues[0]?.message).toContain("pageUrl");
    }
  });

  it("rejects extra nested fields inside summary", () => {
    const body = clone();
    (body.summary as unknown as Record<string, unknown>).pageTitle = "Video";
    const result = insightsRequestSchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID installId", () => {
    const body = clone();
    body.installId = "not-a-uuid";
    expect(insightsRequestSchema.safeParse(body).success).toBe(false);
  });

  it("rejects uppercase or URL-like domains", () => {
    const body = clone();
    body.summary.topBlockedDomains = [{ domain: "YouTube.com", attempts: 5 }];
    expect(insightsRequestSchema.safeParse(body).success).toBe(false);
    body.summary.topBlockedDomains = [
      { domain: "https://youtube.com/watch", attempts: 5 },
    ];
    expect(insightsRequestSchema.safeParse(body).success).toBe(false);
  });

  it("rejects more than 3 blocked domains", () => {
    const body = clone();
    body.summary.topBlockedDomains = [1, 2, 3, 4].map((n) => ({
      domain: `site${n}.com`,
      attempts: n,
    }));
    expect(insightsRequestSchema.safeParse(body).success).toBe(false);
  });

  it("rejects out-of-range numbers", () => {
    const body = clone();
    body.summary.totalFocusMinutes = 10081;
    expect(insightsRequestSchema.safeParse(body).success).toBe(false);
    const body2 = clone();
    body2.summary.streakDays = -1;
    expect(insightsRequestSchema.safeParse(body2).success).toBe(false);
  });

  it("rejects a missing day key in minutesByDay", () => {
    const body = clone();
    delete (body.summary.minutesByDay as Record<string, number>).Sun;
    expect(insightsRequestSchema.safeParse(body).success).toBe(false);
  });

  it("allows previousWeekFocusMinutes to be null", () => {
    const body = clone();
    body.summary.previousWeekFocusMinutes = null;
    expect(insightsRequestSchema.safeParse(body).success).toBe(true);
  });

  it("rejects a week longer than 40 characters", () => {
    const body = clone();
    body.summary.week = "x".repeat(41);
    expect(insightsRequestSchema.safeParse(body).success).toBe(false);
  });
});
