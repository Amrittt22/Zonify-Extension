# Zonify

**Get in the zone.** A Pomodoro timer with a site blocker, packaged as a Chrome extension (Manifest V3).

TypeScript · React 18 · Vite · `@crxjs/vite-plugin` · no accounts, no analytics.
Everything lives in `chrome.storage.local`; the optional AI insight is the one
feature that can send anything anywhere, and it is **off by default**.

> The repo also contains a [`backend/`](../backend) that turns your weekly
> numbers into a short AI insight. When you opt in (Timer tab → *AI insights*),
> only aggregate counts are sent — never URLs, titles or history. See
> [AI insights](#ai-insights-optional).

## Features

- **Pomodoro timer** — focus, short-break and long-break modes with a live ring, session counter and exact tabular countdown. Time is derived from stored timestamps, so the timer keeps running after you close the popup.
- **Site blocking that respects focus** — dynamic `declarativeNetRequest` rules redirect blocked sites to a Zonify page **only while a focus session is running** (never during breaks, pauses or resets).
- **Blocked page** — "You're in the zone." with a 72px live countdown, session dots, a *Back to work* button and *Need a break? End session early*.
- **Desktop notifications** — exactly one notification per finished session, with action buttons (*Start break* / *Skip*, *Start focus*) and an optional system notification sound (no extra permissions).
- **Toolbar badge** — minutes remaining while a session runs (teal for focus, indigo for breaks), cleared when idle.
- **Options page** (hash-routed tabs):
  - **Blocklist** — add/remove blocked domains with validation, plus a *This week* bar card with focus total and day streak.
  - **Timer** — steppers for focus/short/long durations and sessions-before-long-break, and switches for auto-start and sound/notification behavior.
  - **Stats** — today / this week / streak / session cards, a *Last 14 days* chart and a *Most blocked* proportional list. Charts are plain divs — no chart library.
  - **AI insight** (optional, off by default) — switch and server URL in the *Timer* tab; the resulting short weekly summary appears as a card at the top of the *Stats* tab.
- **Privacy** — no accounts, no remote code, and no network calls at all unless you turn AI insights on. `chrome.storage.local` only. Full policy: [`privacy.html`](public/privacy.html) (bundled into `dist/` and linked from the options page); host [`docs/privacy.html`](../docs/privacy.html) for the Chrome Web Store listing.

## Install (unpacked)

```bash
npm install
npm test          # vitest unit tests for the pure libs
npm run build     # icons + typecheck + vite build → dist/
npm run verify:dist  # every manifest reference resolves in dist/ (also runs inside npm run package)
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `dist/` folder

Optional: `npm run package` produces `zonify.zip` for sharing (load unpacked still requires an extracted folder).

During development, `npm run dev` starts Vite with HMR for the popup/options pages; reload the extension after service-worker changes.

## Architecture

```
src/
├─ background/service-worker.ts   ← single source of truth (timer + blocking)
├─ popup/                         ← toolbar popup (360×520)
├─ options/                       ← #blocklist / #timer / #stats tabs
├─ blocked/                       ← DNR redirect target
└─ lib/
   ├─ types.ts      storage keys, alarm/rule constants, message union
   ├─ storage.ts    typed chrome.storage.local helpers + defaults
   ├─ timer.ts      state-machine helpers + formatters (pure)
   ├─ rules.ts      DNR rule build/sync (IDs 1000–1999)
   ├─ stats.ts      local-day aggregations (pure)
   ├─ domain.ts     blocklist input validation (pure)
   ├─ api.ts        backend client + failure mapping (pure)
   ├─ insights.ts   stats → API payload mapping (pure)
   └─ hooks.ts      useStorageValue / useTick React hooks
```

`tests/` (sibling of `src/`) holds vitest unit tests for the pure helpers —
`npm test`.

Key rules the code follows:

- **No in-memory timer state.** `TimerState` stores `{ mode, endsAt, remainingMs, isRunning, completedSessions, sessionIndex }`; time left is always `endsAt - Date.now()`. MV3 service workers sleep, so this survives suspension, restarts and laptop sleep.
- **All listeners are registered at the top level**; every mutation runs through a serial queue and ends in an idempotent `reconcile()` that makes alarms, badge and DNR rules match stored state (including catching up a session end that happened while the browser was asleep).
- **Two alarms:** `session-end` (one-shot, at `endsAt`) and `badge-tick` (every minute).
- **Blocking rules:** one redirect rule per domain (`||domain^`), fixed ID range 1000–1999, whole range removed before re-adding, re-synced on `onInstalled`, `onStartup`, blocklist changes and every state change.
- **Session history:** up to 1000 entries `{ endedAt, durationMs, mode, endedEarly? }`; stats bucket by **local** calendar days (DST-safe day arithmetic). `endedEarly` is set by the service worker when you skip a focus session.

### Permissions

| Permission | Why |
| --- | --- |
| `storage` | timer state, settings, blocklist, stats |
| `alarms` | session end + badge refresh while the worker sleeps |
| `notifications` | one actionable notification per finished session |
| `declarativeNetRequest` | redirect blocked sites during focus |
| `<all_urls>` host permission | matching navigations for DNR rules |

### Sound note

Zonify uses the **system notification sound** (the notification's `silent` flag is tied to the *Sound* setting) so no extra permissions (offscreen/audio) are required.

## AI insights (optional)

The Stats tab starts with a **weekly insight** card. It is **off by default** —
with the switch off, the extension makes no network calls whatsoever.

Turn it on in **Timer → AI insights**, point it at your
[`backend/`](../backend) (default `http://localhost:8787`) and press *Test
connection* to ping `/health`.

### What is sent

One `POST /v1/insights` per insight: a random `installId` (used only for quota
fairness) plus whole-number weekly aggregates.

| Field | Example |
| --- | --- |
| `week` | `19 Oct - 25 Oct` |
| `totalFocusMinutes` | `110` |
| `minutesByDay` | `{ Mon: 25, Tue: 25, … Sun: 0 }` |
| `minutesByHourBucket` | `{ morning: 60, afternoon: 25, evening: 25 }` |
| `sessionsCompleted`, `sessionsStartedButEndedEarly`, `streakDays` | `5`, `1`, `4` |
| `topBlockedDomains` | `[{ domain: "youtube.com", attempts: 84 }]` |
| `previousWeekFocusMinutes` | `50`, or `null` when last week had no focus |

Never sent: URLs, page titles, search terms, timestamps or history. The backend
schema is `.strict()`, so any extra field is rejected with `400
INVALID_REQUEST` — that schema is the actual privacy guarantee (see
[`backend/README.md`](../backend/README.md)).

### Details worth knowing

- Time buckets are assigned by the hour a session **started**: morning
  `05:00–11:59`, afternoon `12:00–17:59`, evening `18:00–04:59`.
- `topBlockedDomains` comes from the lifetime block counters (they carry no
  timestamps), clamped to the top 3.
- Sessions logged by older versions have no `endedEarly` flag; those count as
  "ended early" only when they ran ≥ 1 minute short of the focus target.
- The last insight is cached in `chrome.storage.local` together with the week it
  describes, so reopening the options page shows it instantly. *New insight*
  regenerates it (and counts against the server's daily quota).
- Quotas and errors are surfaced as plain sentences: `NOT_ENOUGH_DATA` (*finish
  3 focus sessions*), `DAILY_LIMIT`, `RATE_LIMITED` (with the wait),
  `SERVICE_BUSY`, `TIMEOUT`, `UPSTREAM_ERROR`, and `ORIGIN_NOT_ALLOWED` (see
  below). The button is disabled while a request is in flight.

### Server requirements

`ALLOWED_ORIGINS` must include the extension's origin, or every request is
rejected with `403 ORIGIN_NOT_ALLOWED`. Find your ID on `chrome://extensions`:

```bash
ALLOWED_ORIGINS=chrome-extension://<extension-id> npm start
```

Add `http://localhost:5173` as well if you also probe the API from a Vite dev
page (`npm run dev`).

## Manual test checklist

- [ ] Start focus → close popup → badge shows minutes left; reopen popup → countdown continues.
- [ ] Pause → sites in the blocklist load normally; Resume → they redirect again.
- [ ] Restart Chrome mid-session → remaining time and blocking survive.
- [ ] Let a session end → exactly **one** notification; *Start break* and *Skip* work.
- [ ] Visit a blocked site during focus → Zonify page with live countdown; *Back to work* returns; *End session early* ends the session.
- [ ] Break end → *Break over. Ready to focus?* notification; auto-start switches honored.
- [ ] Stats show correct today/week/streak values after midnight (local days).
- [ ] Timer → *AI insights* → toggle on → URL saved → *Test connection* reports *Reachable*.
- [ ] After 3 focus sessions this week → Stats → *Generate insight* → card shows the backend's headline, bullets and suggestion.
- [ ] Toggle AI insights off → card says it is off and no request is sent.
- [ ] `npm run build` → load `dist/` → no console errors anywhere.

## License

[MIT](./LICENSE)
