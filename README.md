# Zonify

**Get in the zone.** A Pomodoro timer with a site blocker, plus an optional
AI weekly-insights service that never sees your browsing data.

[![CI](https://github.com/Amrittt22/Zonify-Extension/actions/workflows/ci.yml/badge.svg)](https://github.com/Amrittt22/Zonify-Extension/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Amrittt22/Zonify-Extension)](https://github.com/Amrittt22/Zonify-Extension/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Live backend (mock mode):** https://zonify-backend-co8a.onrender.com — point the
extension's *AI insights* URL here to try it without running anything locally.

```
Zonify-Extension/
├─ frontend/   Chrome extension (Manifest V3) — timer, blocker, stats
└─ backend/    Insights API — strict-schema proxy to the LLM provider
```

## Quick start

To build and load the extension locally:

```bash
cd frontend
npm install
npm test
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load
unpacked**, and select `frontend/dist`.

For the optional insights service, run the backend separately:

```bash
cd ..\backend
npm install
copy .env.example .env       # Windows PowerShell
npm run build
npm start
```

Set `MOCK_LLM=true` in `.env` for local development without an API key. The
extension and backend setup is documented in the sections below.

## frontend — Chrome extension

TypeScript · React 18 · Vite · `@crxjs/vite-plugin` · no accounts, no remote
code. Live timer (survives closing the popup), `declarativeNetRequest` blocking
that only runs during focus sessions, blocked page with countdown, one
notification per session, options page with blocklist, timer settings and
stats.

The Stats tab also has an opt-in **weekly insight** card: with your permission it
sends aggregate weekly numbers to `backend/` and shows a short AI-written
summary. Off by default.

**Install from a release (recommended)**

1. Download the latest `zonify-v*.zip` from the
   [Releases page](https://github.com/Amrittt22/Zonify-Extension/releases/latest).
2. Unzip it (you should see `manifest.json` at the top level of the folder).
3. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select the unzipped folder.

Zonify is currently distributed as a downloadable release and an unpacked
extension; it is not yet available through the Chrome Web Store.

**Build from source**

```bash
cd frontend
npm install
npm test             # vitest unit tests for the pure libs
npm run build        # icons + typecheck + vite build → dist/
npm run package      # → zonify.zip
```

Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
`frontend/dist`. Details: [`frontend/README.md`](frontend/README.md).

Privacy policy (Chrome Web Store): [`docs/privacy.html`](docs/privacy.html) is
ready to host — enable GitHub Pages on `/docs` and paste the resulting URL
into the store listing. The same file is bundled into the extension as
`privacy.html` and linked from the options page.

## backend — insights API

Node 20+ · TypeScript · Express · zod · no database. It sits between the
extension and the LLM provider so the API key stays server-side and users need
no key of their own.

```bash
cd backend
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY, or set MOCK_LLM=true
npm run build && npm test
npm start                # http://localhost:8787

curl -X POST http://localhost:8787/v1/insights -d @sample.json
```

Docker: `docker build -t zonify-backend . && docker run -p 8787:8787 -e MOCK_LLM=true zonify-backend`
(multi-stage, runs as the unprivileged `node` user). Or, for a one-command
local run with a healthcheck: `cp .env.example .env && docker compose up`
(defaults to `MOCK_LLM=true`; edit `.env` for a real key).

Details: [`backend/README.md`](backend/README.md).

### Why the backend is safe to expose

- The request schema is `.strict()`: only aggregate weekly numbers
  (focus minutes, session counts, streak, totals by day/hour bucket, top
  blocked domains with attempt counts) are accepted. URLs, page titles,
  timestamps and history are **rejected at the door** with
  `400 INVALID_REQUEST`.
- Request bodies, API keys and model output are never logged — only error
  codes.
- Layered limits: per-IP hourly, per-install daily, and a global daily cap on
  model calls, all enforced before a provider request is made.
- `installId` is for quota fairness, not authentication — the rate limits are
  the real protection.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and
pull request, with no secrets required:

| Job | What it proves |
| --- | --- |
| `extension` | `npm test`, `npm run build`, then `npm run verify:dist` — every path the manifest references exists in `dist/`, MV3, expected permissions only, version matches `package.json`. Uploads `dist/` as an artifact. |
| `api` | Typecheck, tests and build on **Node 20 and 22** (the supported floor and the current LTS). |
| `image` | Builds the Docker image, starts it keyless with `MOCK_LLM=true`, then asserts over real HTTP: an allowed origin gets an insight (`200`), one extra field in the body is rejected (`400 INVALID_REQUEST`), and an unlisted origin is rejected (`403 ORIGIN_NOT_ALLOWED`). |

The image job is the one that guards the privacy contract: it fails if the
strict schema ever starts accepting extra fields.

## Project state

- **v1.0.0 released** — download the unpacked extension from the
  [Releases page](https://github.com/Amrittt22/Zonify-Extension/releases/latest).
- **Live backend** (mock mode) at
  https://zonify-backend-co8a.onrender.com — point the extension's AI-insights
  URL here to try it without running anything locally.
- The frontend and backend include automated unit tests, TypeScript
  type-checking, and production build scripts.
- GitHub Actions validates the extension build, backend build and tests, and a
  Docker-based API smoke test on every push and pull request.
- Manual Chrome validation is still recommended before publishing a release:
  use the checklist in [`frontend/README.md`](frontend/README.md#manual-test-checklist).
- The optional AI-insights flow is wired end to end, but requires a running
  backend with the extension origin listed in `ALLOWED_ORIGINS`.

## Wiring them together

The Stats tab starts with an **AI insight** card that is **off by default**: until
you enable it, the extension makes no network requests at all.

1. Start the backend with your extension's origin allowed — `chrome://extensions`
   shows the ID:
   ```bash
   cd backend
   ALLOWED_ORIGINS=chrome-extension://<extension-id> npm start
   ```
   (`MOCK_LLM=true` works too and needs no API key: you get a canned insight
   built from your numbers.)

   A hosted instance is available at
   `https://zonify-backend-co8a.onrender.com` (mock mode) — use that URL in
   step 2 instead of running locally. Free tier cold-starts take 20–50 s.
2. In the extension: **Timer → AI insights** → toggle on → *Test connection*
   should report *Reachable*.
3. Finish 3 focus sessions, then **Stats → Generate insight**.

Only aggregate numbers cross the wire (see the privacy notes above); the result
is cached per week in `chrome.storage.local`. If `ALLOWED_ORIGINS` does not list
the extension, the card explains the `403 ORIGIN_NOT_ALLOWED`. Full details:
[`frontend/README.md`](frontend/README.md#ai-insights-optional).

## License

MIT — see [`LICENSE`](LICENSE). The extension keeps its own copy at
[`frontend/LICENSE`](frontend/LICENSE).
