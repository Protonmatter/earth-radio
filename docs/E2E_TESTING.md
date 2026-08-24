# End-to-end UI testing

`tests/e2e/` holds a Playwright suite that drives the staged `site/` bundle in Chromium
the way a listener would, with a focus on two properties:

1. **Idempotency** — the same set (or combination) of user actions must always converge
   to the same UI state: selecting the same station twice, next→previous round trips,
   double-toggling favorite and play/pause.
2. **Progressive disclosure on the map** — hovering a station dot must reveal the
   station (name, country, codec/bitrate, and a best-effort now-playing line) *before*
   selection, hover alone must not select, and clicking the hovered dot must select
   exactly the disclosed station.

## Hermetic by construction

- `tests/e2e/serve-site.mjs` serves `site/` on a loopback port (Playwright `webServer`).
- Every external request is intercepted: the Radio Browser directory is answered from
  `tests/e2e/fixtures/stations.mjs` (real-city coordinates so clustering behaves like
  production), fixture stream URLs return a generated silent WAV so the player genuinely
  reaches a playing state, and everything else (map tiles, favicons, other directories)
  is aborted so failures are deterministic.
- Service workers are blocked in the test context so route interception stays in charge
  across repeated runs.

## Running

```bash
npm run test:e2e
```

Locally the suite reuses a pinned Chromium when one is provisioned
(`/opt/pw-browsers/chromium`); otherwise install browsers once with
`npx playwright install chromium`. CI runs the suite as a separate `e2e` job with the
Playwright HTML report uploaded on failure.

## Adding cases

When a UI/UX bug is found, encode the exact action combination as a new spec in
`tests/e2e/app.spec.mjs` (or a sibling spec file) before fixing it — the suite is the
regression net for "same actions, same result" reliability.
