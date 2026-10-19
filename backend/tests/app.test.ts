import { readFileSync } from "node:fs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import type { InsightsRequest } from "../src/schema.js";

const ALLOWED_ORIGIN = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef";

const sample: InsightsRequest = JSON.parse(
  readFileSync(new URL("../sample.json", import.meta.url), "utf8"),
);

function makeApp(overrides: Record<string, string> = {}) {
  const config: AppConfig = loadConfig({
    MOCK_LLM: "true",
    ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    ...overrides,
  } as NodeJS.ProcessEnv);
  return createApp(config);
}

function clone(): InsightsRequest {
  return structuredClone(sample);
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const app = makeApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("POST /v1/insights", () => {
  it("returns an insight for a valid body (200)", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/v1/insights")
      .set("Origin", ALLOWED_ORIGIN)
      .send(sample);
    expect(res.status).toBe(200);
    expect(typeof res.body.insight.headline).toBe("string");
    expect(Array.isArray(res.body.insight.highlights)).toBe(true);
    expect(res.body.insight.highlights.length).toBeGreaterThanOrEqual(2);
    expect(res.body.insight.highlights.length).toBeLessThanOrEqual(3);
    expect(typeof res.body.insight.suggestion).toBe("string");
  });

  it("rejects extra fields with 400 INVALID_REQUEST and issue paths", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/v1/insights")
      .set("Origin", ALLOWED_ORIGIN)
      .send({ ...clone(), pageUrl: "https://youtube.com/watch" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_REQUEST");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect(res.body.issues[0]).toHaveProperty("path");
    expect(res.body.issues[0]).toHaveProperty("message");
  });

  it("returns 422 NOT_ENOUGH_DATA below 3 completed sessions", async () => {
    const app = makeApp();
    const body = clone();
    body.summary.sessionsCompleted = 2;
    const res = await request(app)
      .post("/v1/insights")
      .set("Origin", ALLOWED_ORIGIN)
      .send(body);
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "NOT_ENOUGH_DATA" });
  });

  it("enforces the per-install daily limit on the 6th request (429 DAILY_LIMIT)", async () => {
    const app = makeApp({ DAILY_LIMIT_PER_INSTALL: "5" });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/v1/insights")
        .set("Origin", ALLOWED_ORIGIN)
        .send(sample);
      statuses.push(res.status);
      if (i === 5) {
        expect(res.status).toBe(429);
        expect(res.body.error).toBe("DAILY_LIMIT");
        expect(res.body.retryAfterSec).toBeGreaterThan(0);
        expect(res.headers["retry-after"]).toBeDefined();
      }
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("does not consume the daily quota for NOT_ENOUGH_DATA or invalid bodies", async () => {
    const app = makeApp({ DAILY_LIMIT_PER_INSTALL: "2" });
    const lite = clone();
    lite.summary.sessionsCompleted = 0;
    await request(app).post("/v1/insights").set("Origin", ALLOWED_ORIGIN).send(lite);
    await request(app)
      .post("/v1/insights")
      .set("Origin", ALLOWED_ORIGIN)
      .send({ bogus: true });
    // Both quota-consuming requests remain available.
    const first = await request(app)
      .post("/v1/insights")
      .set("Origin", ALLOWED_ORIGIN)
      .send(sample);
    const second = await request(app)
      .post("/v1/insights")
      .set("Origin", ALLOWED_ORIGIN)
      .send(sample);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("rate limits by IP after IP_LIMIT_PER_HOUR (429 RATE_LIMITED)", async () => {
    const app = makeApp({ IP_LIMIT_PER_HOUR: "2" });
    expect(
      (await request(app).post("/v1/insights").send(sample)).status,
    ).toBe(200);
    expect(
      (await request(app).post("/v1/insights").send(sample)).status,
    ).toBe(200);
    const res = await request(app).post("/v1/insights").send(sample);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("RATE_LIMITED");
    expect(res.body.retryAfterSec).toBeGreaterThan(0);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("returns 400 INVALID_JSON for malformed JSON", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/v1/insights")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_JSON");
  });

  it("returns 413 TOO_LARGE for bodies over 10kb", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/v1/insights")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ pad: "x".repeat(11_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("TOO_LARGE");
  });
});

describe("origin gate", () => {
  it("rejects disallowed origins with 403 ORIGIN_NOT_ALLOWED", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/v1/insights")
      .set("Origin", "https://evil.example")
      .send(sample);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "ORIGIN_NOT_ALLOWED" });
  });

  it("allows requests with no Origin header (curl, server-to-server)", async () => {
    const app = makeApp();
    const res = await request(app).post("/v1/insights").send(sample);
    expect(res.status).toBe(200);
  });

  it("adds CORS headers for allowed origins", async () => {
    const app = makeApp();
    const res = await request(app)
      .options("/v1/insights")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
  });
});

describe("misc", () => {
  it("returns JSON 404 for unknown routes", async () => {
    const app = makeApp();
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
  });

  it("does not advertise the framework (x-powered-by disabled)", async () => {
    const app = makeApp();
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("enforces the global daily cap (429 SERVICE_BUSY)", async () => {
    const app = makeApp({ GLOBAL_DAILY_LIMIT: "2", IP_LIMIT_PER_HOUR: "1000" });
    await request(app).post("/v1/insights").send(sample);
    await request(app).post("/v1/insights").send(sample);
    const res = await request(app).post("/v1/insights").send(sample);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("SERVICE_BUSY");
  });
});
