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

Cache policy is part of the deployment boundary. Only filenames carrying an eight-character content hash may receive `max-age=31536000, immutable`. Maintained overlays such as `responsive-ui.css`, `responsive-ui.js`, `ui-refresh.css`, `auth-core.js`, `auth-ui.js`, `auth-ui.css`, `sync-core.js`, and `metadata-enrichment.*` must remain short-lived and revalidating. When those shell assets change, bump the service-worker cache generation; installation uses `cache: 'reload'` for overlays to prevent an existing browser HTTP cache from contaminating the new service-worker cache, and `force-cache` for the content-hashed runtime bundles. A failed reload leaves the previous worker and cache in place. `npm run verify:site` rejects any deployed non-fingerprinted file that inherits an immutable rule.

## Local smoke

The discovery candidate also requires `npm run test:e2e -- --workers=3` and `npm run test:rendered` before release. The rendered matrix writes temporary evidence under `.build/evidence/responsive-ui` so validation does not overwrite historical tracked captures. Empty unavailable-renderer reasons are converted to `false`; genuine rendered failures must fail the command instead of being counted as skipped.

For discovery smoke, enter a multiword name/place query, a non-Latin query, and a misspelled genre; check no autoplay occurs. Exercise genre/language/bitrate and HTTPS filters, reset, recent ordering, Similar, and a no-results case. Open Details using the keyboard and dismiss with Escape; play from it and check the selected station matches the disclosed name. On a phone viewport expand/collapse Refine selection and confirm the station list remains usable.

For atlas smoke, verify visible coastlines in both Night/Paper palettes without CARTO/tile requests, pan and zoom, capture Search this area, clear it, fit the current results, and focus the playing station. Stations without coordinates must appear in the list and the unmapped count. Directory refreshes must update marker payloads as well as styles. Verify offline coastlines after a successful worker install; fresh directories and live audio still require connectivity.

After an audited recovered-runtime edit run `node scripts/fingerprint-runtime.mjs`, then regenerate the release manifest after all edits settle. Never reuse an immutable filename with different bytes. The discovery candidate uses worker cache `earth-radio-shell-v51-release-0-25-0` and precaches all maintained discovery/map modules and versioned icon PNGs together. Branding and the manifest use network-first delivery with an offline shell-cache fallback.

Area-search qualification must start with a country absent from the initial pool,
not merely click the button over existing markers. Verify a mapped-directory
request, newly visible stations/markers, retained music filters, cleared conflicting
country/Favorites/Recent state, retry after outage, and a usable Clear area action
on the phone map. The new map loader is bounded and is not exhaustive coverage.

```powershell
npm run build:web
python -m http.server 8788 --directory .build/site
```

Open `http://127.0.0.1:8788/` in a real browser. Inspect the console/network log for missing assets, verify catalog loading and search/filter behavior, reload to test persistence and service-worker activation, and try a known compatible HTTPS MP3/AAC stream. On a narrow viewport confirm the Atlas/Browse/Kept/You destinations, the header search action that replaced the old Search tab, the Night/Paper palette and glass controls on You (the basemap must follow the palette, not just the chrome), the mini-player, and Now Playing Back behavior; on a wide viewport confirm the adjustable list/map split. Station failure alone is not proof of an application defect; capture the URL, status, content type, CORS result, and codec.

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

Release 0.25.0 was explicitly authorized as a direct upload from the verified
working tree. Its exact public hashes and deployment identity are in
`docs/RELEASE-0.25.0.md`; the Git source label alone does not identify those bytes.
The user subsequently authorized committing/pushing this release and merging only
after CI passes. Reconcile this source through that workflow before another unrelated
Git-triggered deployment, because old main can replace the direct upload and its
guarded Functions. Verify the merge-triggered production build and asset hashes.

## Edge metadata Functions runbook

The `/api/nowplaying` and `/api/track/fingerprint` Pages Functions fetch listener-supplied
stream URLs. Their in-code protections (manual revalidated redirects, hop caps, byte caps,
wall-clock deadlines) are complemented by required deployment configuration; the full
deployment procedure lives in `docs/CLOUDFLARE_DEPLOYMENT.md`.

1. **Strict public fetch routing.** `wrangler.jsonc` sets the
   `global_fetch_strictly_public` compatibility flag so global `fetch()` routes through
   the public Internet boundary and can never privately reach a same-zone origin.
   `scripts/validate-repository.mjs` fails the build if the flag is dropped or
   `global_fetch_private_origin` appears. Confirm the flag is active on the Pages
   project after the first deployment with this file (Settings → Functions →
   Compatibility flags).
2. **Durable quotas.** Deploy the private Worker from `workers/rate-limit/wrangler.jsonc` before Pages. Root configuration binds both environments and sets `METADATA_LIMIT_SCOPE` explicitly. Middleware applies rolling 30/minute/IP now-playing and 6/minute/IP fingerprint budgets before handlers, including probes/cache hits, with 60-second mitigation. Missing bindings, scope or trusted identity and RPC failures return 503. Denied requests still consume a Pages/DO invocation but perform no metadata/provider work. No new analytics/log collection is enabled. Follow the full deployment/rollback runbook before publishing.
3. **Preview validation.** After deploying, verify on the preview URL that
   (a) `/api/nowplaying` answers the probe, (b) a request for a public redirecting
   stream resolves, (c) a request for a loopback/private URL returns HTTP 400 without
   any outbound fetch in the Function logs, and (d) rate-limited requests receive 429
   without invoking outbound fetches.
4. **Optional fingerprint credentials** (requires explicit provider/billing authorization): set
   `AUDD_API_TOKEN` or `ACR_HOST`/`ACR_ACCESS_KEY`/`ACR_ACCESS_SECRET` as Pages
   project environment variables. Without them `/api/track/fingerprint` reports
   `available: false`, the Identify button stays hidden, and auto-identify on miss
   does not run. With them, a playing station that has no structured feed is sampled
   once after 8 seconds.

## CI inspection

GitHub Actions is defined in `.github/workflows/ci.yml` with read-only contents permission and immutable action commit pins. When a repository exists, inspect both Linux and Windows jobs for the exact commit. A green local run does not substitute for remote CI.

`.github/workflows/supabase.yml` starts a local Supabase stack on every pull request: pgTAP RLS tests against `supabase db start`, then the production PKCE client against local GoTrue and Mailpit. That workflow is also read-only and does not use hosted project secrets.

## Rollback

Follow `docs/CLOUDFLARE_DEPLOYMENT.md` for guarded rollback. A UI-only rollback
must upload a preserved static artifact with the current Functions and quota
binding/scope. Do not roll the entire project back to a pre-0.25.0 deployment,
which lacks durable rate control. Keep a failed limiter fail-closed at 503 while
repairing it; do not remove the binding or delete its namespace to bypass denial.
Preserve failed artifacts/logs for diagnosis. A source correction uses a normal
forward commit only after authorization; never force-push or delete evidence.

For local desktop rollback, uninstall the newly packaged candidate and reinstall the known installer only if its provenance and hash were separately recorded. The current installed app and supplied archives are outside this repository and must not be modified by build or recovery commands.
