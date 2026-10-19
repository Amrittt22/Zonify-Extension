import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { getConfig, type AppConfig } from "./config.js";
import { generateInsight, LlmError } from "./llm.js";
import { createLimiter } from "./rateLimit.js";
import { insightsRequestSchema, toIssues } from "./schema.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Error codes returned by the API (the only strings logged or shared —
 * never request bodies, API keys or model output):
 *
 *  400 INVALID_JSON        body was not valid JSON
 *  400 INVALID_REQUEST     body failed the strict schema (issues[] attached)
 *  403 ORIGIN_NOT_ALLOWED  Origin header not in ALLOWED_ORIGINS
 *  413 TOO_LARGE           body over the 10kb limit
 *  422 NOT_ENOUGH_DATA     fewer than 3 completed sessions (no model call)
 *  429 RATE_LIMITED        per-IP hourly limit
 *  429 DAILY_LIMIT         per-install daily limit
 *  429 SERVICE_BUSY        global daily model-call cap
 *  502 UPSTREAM_ERROR      provider request failed / non-2xx
 *  502 BAD_MODEL_OUTPUT    provider replied but output was unusable
 *  504 TIMEOUT             provider did not answer within 20s
 *  500 INTERNAL            unexpected server error
 *  404 NOT_FOUND           unknown route
 */
export function createApp(config: AppConfig = getConfig()): express.Express {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);

  // Fresh limiters per app instance (tests stay isolated).
  const ipLimiter = createLimiter();
  const installLimiter = createLimiter();
  const globalLimiter = createLimiter();

  const allowedOrigins = new Set(config.allowedOrigins);

  // (0) Origin gate, before everything else.
  // NOTE: CORS is NOT authentication — anyone can spoof an Origin header.
  // The rate limits below are the real protection; CORS only stops other
  // web pages from reading our responses in a user's browser.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      res.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
      return;
    }
    next();
  });

  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, !origin || allowedOrigins.has(origin)),
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    }),
  );

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // (1) Per-IP limit — runs BEFORE body parsing and validation, so junk
  // requests from an exhausted IP never cost more than a rate-limit check.
  const ipLimit = (req: Request, res: Response, next: NextFunction): void => {
    const result = ipLimiter.hit(
      `ip:${req.ip ?? "unknown"}`,
      config.ipLimitPerHour,
      HOUR_MS,
    );
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSec));
      res.status(429).json({
        error: "RATE_LIMITED",
        retryAfterSec: result.retryAfterSec,
      });
      return;
    }
    next();
  };

  app.post(
    "/v1/insights",
    ipLimit,
    // Accept any Content-Type (the extension may send text/plain; curl
    // defaults to urlencoded) but always parse as JSON, capped at 10kb.
    express.json({ limit: "10kb", type: "*/*" }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // (2) Strict validation — this is the privacy guarantee.
        const parsed = insightsRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "INVALID_REQUEST",
            issues: toIssues(parsed.error),
          });
          return;
        }
        const { installId, summary } = parsed.data;

        // (3) Too little data → 422 without spending a model call (and
        // without consuming the install's daily quota).
        if (summary.sessionsCompleted < 3) {
          res.status(422).json({ error: "NOT_ENOUGH_DATA" });
          return;
        }

        // (4) Per-install daily limit.
        const installHit = installLimiter.hit(
          `install:${installId}`,
          config.dailyLimitPerInstall,
          DAY_MS,
        );
        if (!installHit.allowed) {
          res.setHeader("Retry-After", String(installHit.retryAfterSec));
          res.status(429).json({
            error: "DAILY_LIMIT",
            retryAfterSec: installHit.retryAfterSec,
          });
          return;
        }

        // (5) Global daily cap — protects provider spend.
        const globalHit = globalLimiter.hit(
          "global",
          config.globalDailyLimit,
          DAY_MS,
        );
        if (!globalHit.allowed) {
          res.setHeader("Retry-After", String(globalHit.retryAfterSec));
          res.status(429).json({
            error: "SERVICE_BUSY",
            retryAfterSec: globalHit.retryAfterSec,
          });
          return;
        }

        // (6) Model call.
        const insight = await generateInsight(summary, {
          model: config.model,
          apiKey: config.anthropicApiKey,
          mock: config.mockLlm,
        });
        res.status(200).json({ insight });
      } catch (error) {
        if (error instanceof LlmError) {
          res
            .status(error.code === "TIMEOUT" ? 504 : 502)
            .json({ error: error.code });
          return;
        }
        next(error);
      }
    },
  );

  // Unknown routes → JSON 404 (before the error handler).
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  // Final error handler: never leak stack traces or internals.
  const errorHandler: express.ErrorRequestHandler = (err, _req, res, _next) => {
    const type =
      typeof err?.type === "string" ? (err.type as string) : undefined;
    if (type === "entity.parse.failed") {
      res.status(400).json({ error: "INVALID_JSON" });
      return;
    }
    if (type === "entity.too.large") {
      res.status(413).json({ error: "TOO_LARGE" });
      return;
    }
    // Log the error classification only — never the payload.
    console.error(`[error] ${type ?? err?.name ?? "unknown"}`);
    res.status(500).json({ error: "INTERNAL" });
  };
  app.use(errorHandler);

  return app;
}
