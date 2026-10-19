# Zonify Backend

A small Node/TypeScript API that sits between the
[Zonify Chrome extension](../frontend) and the Anthropic Messages API, so the
provider API key stays on the server and users never need one of their own.

```
Zonify extension  ──POST /v1/insights (aggregate weekly numbers only)──▶
Zonify backend    ──POST /v1/messages (server-side API key)──▶  Anthropic
```

## Privacy by design

The request schema is the privacy guarantee.

- The endpoint **only** accepts the aggregate fields listed below — the zod
  schema is `.strict()`, so a URL, page title, timestamp, browsing history or
  any other extra key is rejected with `400 INVALID_REQUEST`. Such data can
  never reach the logs or the model, because it is rejected before anything
  else happens.
- Request bodies are **never logged**. Neither are API keys or model output —
  the only strings logged are error codes such as `INVALID_REQUEST`.
- The body is capped at **10 KB**.
- Rate limits reject abusive traffic *before* the body is even parsed.
- CORS restricts browser origins for convenience only — **CORS is not
  authentication** (an Origin header is trivially spoofable). The rate limits
  are the real protection.

## Endpoints

### `GET /health`

```json
{ "ok": true }
```

### `POST /v1/insights`

Request body (see [`sample.json`](./sample.json) for a valid example):

| Field | Type | Constraints |
| --- | --- | --- |
| `installId` | string | UUID |
| `summary.week` | string | 1–40 chars |
| `summary.totalFocusMinutes` | int | 0–10080 |
| `summary.sessionsCompleted` | int | 0–500 (**min 3 to generate**) |
| `summary.sessionsStartedButEndedEarly` | int | 0–500 |
| `summary.streakDays` | int | 0–3650 |
| `summary.minutesByDay` | object | `Mon`…`Sun`, each 0–10080 |
| `summary.minutesByHourBucket` | object | `morning`/`afternoon`/`evening`, each 0–10080 |
| `summary.topBlockedDomains` | array | ≤ 3 of `{ domain, attempts }`; `domain` must be a lowercase hostname, `attempts` 0–100000 |
| `summary.previousWeekFocusMinutes` | int \| null | 0–10080 |

Success — `200`:

```json
{
  "insight": {
    "headline": "12 hours of focus this week",
    "highlights": [
      "14 sessions completed, 3 ended early, 6-day streak.",
      "Up 180 minutes versus last week — nice momentum.",
      "Most blocked: youtube.com with 84 blocked attempts."
    ],
    "suggestion": "Pick your top blocked site and schedule one 25-minute focus block for it tomorrow."
  }
}
```

Errors — always `{ "error": "<CODE>" }` (plus `issues[]` or `retryAfterSec`
where noted):

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_JSON` | Body was not valid JSON |
| 400 | `INVALID_REQUEST` | Failed the strict schema; `issues: [{ path, message }]` |
| 403 | `ORIGIN_NOT_ALLOWED` | `Origin` header not in `ALLOWED_ORIGINS` |
| 413 | `TOO_LARGE` | Body over 10 KB |
| 422 | `NOT_ENOUGH_DATA` | Fewer than 3 completed sessions — no model call |
| 429 | `RATE_LIMITED` | Per-IP hourly limit; includes `Retry-After` + `retryAfterSec` |
| 429 | `DAILY_LIMIT` | Per-install daily limit (default 5/day) |
| 429 | `SERVICE_BUSY` | Global daily model-call cap reached |
| 502 | `UPSTREAM_ERROR` | Provider request failed or returned non-2xx |
| 502 | `BAD_MODEL_OUTPUT` | Provider answered but the output was unusable |
| 504 | `TIMEOUT` | Provider did not answer within 20 s |
| 500 | `INTERNAL` | Unexpected error (no stack traces leaked) |
| 404 | `NOT_FOUND` | Unknown route |

Request pipeline, in order: per-IP rate limit → strict validation →
data-richness check → per-install daily limit → global daily cap → model call.

## Configuration

Copy `.env.example` to `.env` and fill in values:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on |
| `ANTHROPIC_API_KEY` | — | **Required unless `MOCK_LLM=true`.** Server-side provider key |
| `MODEL` | `claude-haiku-5-5` | Model used for insight generation |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated allowed origins, e.g. `chrome-extension://<your-extension-id>` |
| `TRUST_PROXY` | `false` | `true` behind a proxy/platform so limits see real client IPs |
| `IP_LIMIT_PER_HOUR` | `30` | Per-IP requests per hour |
| `DAILY_LIMIT_PER_INSTALL` | `5` | Insight generations per `installId` per 24 h |
| `GLOBAL_DAILY_LIMIT` | `500` | Model calls per 24 h across all installs |
| `MOCK_LLM` | `false` | `true` = canned insight, no network, no key needed (dev/tests only) |

The server **fails fast at startup** if `ANTHROPIC_API_KEY` is missing while
`MOCK_LLM` is not `true`.

## Run locally

Requires Node 20+.

```bash
npm install
cp .env.example .env      # then add your key (or set MOCK_LLM=true)
npm run build
npm start                  # or: npm run dev (tsx watch)

# smoke test
curl http://localhost:8787/health
curl -X POST http://localhost:8787/v1/insights -d @sample.json
```

Tests (no network, no key):

```bash
npm test           # vitest + supertest
npm run typecheck  # tsc over src + tests
```

## Docker

```bash
docker build -t zonify-backend .
docker run -p 8787:8787 -e ANTHROPIC_API_KEY=sk-... zonify-backend
# development:
docker run -p 8787:8787 -e MOCK_LLM=true zonify-backend
```

Multi-stage build; the final container runs as the unprivileged `node` user.

From the repo root, the same image is available as a one-command run:

```bash
cp ../.env.example ../.env   # once; dev defaults to MOCK_LLM=true
docker compose up            # http://localhost:8787, with a /health healthcheck
```

`docker compose down` stops it. Edit `.env` (or `backend/.env`) for a real
`ANTHROPIC_API_KEY` and `MOCK_LLM=false`.

## Deploying (Render / Railway / Fly)

A live instance runs at `https://zonify-backend-co8a.onrender.com` (mock mode).

- Put `ANTHROPIC_API_KEY` in the platform's **secret store**, never in the
  image or the repo.
- Set `TRUST_PROXY=true` — platforms run you behind a proxy, and without it
  every request appears to come from the proxy's IP (so the per-IP limit
  would treat all users as one).
- Set `ALLOWED_ORIGINS=chrome-extension://<your-extension-id>` once the
  extension is published (its ID is fixed after first publication).
- Free tiers sleep after idle: the **first request after idle is slow** (cold
  start, often 20–50 s) — give the client a generous timeout or ping
  `/health` to wake it.
- The service is horizontally safe only with care — see below.

## Limits

- Rate limits are **in-memory and per-instance**: restarting the process
  resets them, and running N replicas multiplies every limit by N. If you
  scale out, move the limiter to Redis (the interface in
  `src/rateLimit.ts` is three lines to reimplement).
- `installId` is a client-generated UUID for **quota fairness, not
  authentication** — anyone can mint a new one. The per-IP limit and the
  global daily cap are what actually bound spend.
- Windows are rolling 24 h (per install / globally), hourly (per IP).
