# Operations

## Build and validate

Prerequisites are Git, Node.js 24.18.0, npm 11.16.0, and Windows PowerShell 5.1 only for the recovery-import smoke test.

```powershell
npm ci
npm run verify
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/smoke-recovery-import.ps1
git diff --check
```

The static deployment artifact is `.build/site`; do not deploy `site/` or the repository root without staging and validation.

Cache policy is part of the deployment boundary. Only filenames carrying an eight-character content hash may receive `max-age=31536000, immutable`. Maintained overlays such as `responsive-ui.css`, `responsive-ui.js`, `ui-refresh.css`, and `metadata-enrichment.*` must remain short-lived and revalidating. When those shell assets change, bump the service-worker cache generation; installation uses `cache: 'reload'` to prevent an existing browser HTTP cache from contaminating the new service-worker cache. A failed reload leaves the previous worker and cache in place. `npm run verify:site` rejects any deployed non-fingerprinted file that inherits an immutable rule.

## Local smoke

```powershell
npm run build:web
python -m http.server 8788 --directory .build/site
```

Open `http://127.0.0.1:8788/` in a real browser. Inspect the console/network log for missing assets, verify catalog loading and search/filter behavior, reload to test persistence and service-worker activation, and try a known compatible HTTPS MP3/AAC stream. On a narrow viewport confirm Listen/Search/Map/Saved, the mini-player, and Now Playing Back behavior; on a wide viewport confirm the adjustable list/map split. Station failure alone is not proof of an application defect; capture the URL, status, content type, CORS result, and codec.

## Deploy

Production uses a Git-integrated Cloudflare Pages project with:

```text
Production branch: main
Build command: npm ci && npm run build:web
Output directory: .build/site
Node: 24.18.0
```

The Cloudflare GitHub App must remain scoped to **Only select repositories**, with only the Earth Radio repository selected. Do not broaden organization access or persist an API token in this repository.

Every merge to `main` triggers a production deployment. Match the Cloudflare deployment commit to the tested Git commit, inspect build logs, and then run the browser smoke procedure against `https://earth-radio.pages.dev/`. Update `docs/BUILD_STATE.md` only with verified commit, CI run, and deployment identities.

## Edge metadata Functions runbook

The `/api/nowplaying` and `/api/track/fingerprint` Pages Functions fetch listener-supplied
stream URLs. Their in-code protections (manual revalidated redirects, hop caps, byte caps,
wall-clock deadlines) are complemented by required zone configuration; the full
deployment procedure lives in `docs/CLOUDFLARE_DEPLOYMENT.md`.

1. **Strict public fetch routing.** `wrangler.jsonc` sets the
   `global_fetch_strictly_public` compatibility flag so global `fetch()` routes through
   the public Internet boundary and can never privately reach a same-zone origin.
   `scripts/validate-repository.mjs` fails the build if the flag is dropped or
   `global_fetch_private_origin` appears. Confirm the flag is active on the Pages
   project after the first deployment with this file (Settings → Functions →
   Compatibility flags).
2. **WAF rate limiting (before Function execution).** Create Cloudflare rate-limiting
   rules on the zone:
   - `/api/nowplaying`: 30 requests per source IP per 60 seconds → block with HTTP 429
     for 60 seconds.
   - `/api/track/fingerprint`: 6 requests per source IP per 60 seconds → block with
     HTTP 429 for 60 seconds.
   These fire before the Function executes and are the single durable source of rate
   policy. The metered fingerprint Function deliberately carries no in-isolate
   counter (a per-isolate budget multiplies by isolate count); `/api/nowplaying`
   keeps a best-effort in-isolate limiter as defense in depth only.
3. **Preview validation.** After deploying, verify on the preview URL that
   (a) `/api/nowplaying` answers the probe, (b) a request for a public redirecting
   stream resolves, (c) a request for a loopback/private URL returns HTTP 400 without
   any outbound fetch in the Function logs, and (d) rate-limited requests receive 429
   without invoking outbound fetches.
4. **Fingerprint credentials** (required for universal now-playing): set
   `AUDD_API_TOKEN` or `ACR_HOST`/`ACR_ACCESS_KEY`/`ACR_ACCESS_SECRET` as Pages
   project environment variables. Without them `/api/track/fingerprint` reports
   `available: false`, the Identify button stays hidden, and auto-identify on miss
   does not run. With them, a playing station that has no structured feed is sampled
   once after 8 seconds.

## CI inspection

GitHub Actions is defined in `.github/workflows/ci.yml` with read-only contents permission and immutable action commit pins. When a repository exists, inspect both Linux and Windows jobs for the exact commit. A green local run does not substitute for remote CI.

`.github/workflows/supabase.yml` starts a local Supabase stack on every pull request: pgTAP RLS tests against `supabase db start`, then the production PKCE client against local GoTrue and Inbucket. That workflow is also read-only and does not use hosted project secrets.

## Rollback

Cloudflare rollback is a deployment operation, not a Git history rewrite. Select the last known-good production deployment in the Pages dashboard and roll production back to it, then verify the served commit and public smoke behavior. Preserve the failed deployment and logs for diagnosis. Correct the repository with a normal forward commit; do not force-push or delete evidence.

For local desktop rollback, uninstall the newly packaged candidate and reinstall the known installer only if its provenance and hash were separately recorded. The current installed app and supplied archives are outside this repository and must not be modified by build or recovery commands.
