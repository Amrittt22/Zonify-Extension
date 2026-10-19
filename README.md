# Zonify

**Get in the zone.** A Pomodoro timer with a site blocker, plus an optional
AI weekly-insights service that never sees your browsing data.

```
Zonify-Extension/
├─ frontend/   Chrome extension (Manifest V3) — timer, blocker, stats
└─ backend/    Insights API — strict-schema proxy to the LLM provider
```

## Screenshots

<!-- TODO: replace with a real screenshot/GIF of the popup, blocked page, and Stats tab. -->
![Zonify popup placeholder](docs/screenshot.png)

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

## Status

| Part | State |
| --- | --- |
| `frontend/` | Complete: build green, 35 unit tests passing; manual Chrome checks are the remaining step before publishing |
| `backend/` | Complete: build green, 44 tests passing, Docker image builds and runs; image smoke-tested with `MOCK_LLM=true` |
| Wiring | Built and verified end to end — the payload the extension's mapper produces is accepted by the running backend (`200`), and the same request from an unlisted origin is rejected (`403`) |
| CI | `.github/workflows/ci.yml` — all three jobs green locally (Node 24); `actionlint` clean | |

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
