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

## CI inspection

GitHub Actions is defined in `.github/workflows/ci.yml` with read-only contents permission and immutable action commit pins. When a repository exists, inspect both Linux and Windows jobs for the exact commit. A green local run does not substitute for remote CI.

## Rollback

Cloudflare rollback is a deployment operation, not a Git history rewrite. Select the last known-good production deployment in the Pages dashboard and roll production back to it, then verify the served commit and public smoke behavior. Preserve the failed deployment and logs for diagnosis. Correct the repository with a normal forward commit; do not force-push or delete evidence.

For local desktop rollback, uninstall the newly packaged candidate and reinstall the known installer only if its provenance and hash were separately recorded. The current installed app and supplied archives are outside this repository and must not be modified by build or recovery commands.
