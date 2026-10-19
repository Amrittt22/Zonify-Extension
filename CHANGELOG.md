# Changelog

All notable changes to Zonify are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-10-19

### Added
- Pomodoro timer with focus / short break / long break durations (1–90 / 1–30 / 1–45 min).
- Site blocker powered by `declarativeNetRequest`, active only during focus sessions.
- Blocked page with live countdown, "Back to work" and "End session early".
- Timer survives closing the popup and restarting Chrome (service worker + alarms).
- Pause / resume; exactly one notification per completed session with Start break / Skip actions.
- Break-end notification with optional auto-start.
- Stats tab: today / this week / streak, focus minutes by day (Mon–Sun) and time-of-day bucket, top blocked domains with attempt counts, ended-early tracking.
- Options page: Blocklist, Timer (durations + AI insights), Stats.
- Optional AI weekly insight (off by default): aggregates weekly numbers, sends them to a configurable backend, shows an AI-written summary; cached per week.
- Privacy policy bundled with the extension and linked from the options page.
- Least-privilege permissions: `storage`, `alarms`, `notifications`, `declarativeNetRequest`.

### Notes
- No accounts, no remote code, no network calls unless AI insights are enabled.
- Backend (insights API) ships separately as `zonify-backend`.