# Earth Radio 0.24.0 Build State

Generated: 2026-06-25

## Status

- Imported `EarthRadio-0.24.0-desktop-metadata-source-ready.zip` into the repository.
- Applied metadata hardening from the 0.23.0 UI/metadata review.
- Regenerated `RELEASE_MANIFEST.json` and `sha256sums.txt`.
- Electron installer packaging was not run because this Windows shell has no `node`, `npm`, `npx`, or `corepack` on PATH. Codex bundled Node is available only as `C:\Users\mkang\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`.

## Implemented

- Runtime now-playing bundle no longer seeds Spotify, Apple Music, YouTube Music, or Tidal links from station tags/name before live track metadata exists.
- Recovered source panel now clears provider links in station-only state.
- Server metadata parser rejects ad, promo, weather, traffic, station ID, and other non-track metadata.
- Server metadata parser supports ASCII hyphen, en dash, em dash, `::`, pipe, slash, and `Title by Artist` patterns.
- Candidate scoring is exported for deterministic smoke tests.
- Desktop proxy returns bounded `400` responses for invalid or private stream URLs instead of generic server errors.
- Smoke tests now use Windows-safe repo-root resolution.
- Smoke tests cover parser edge cases, scoring penalties, station-link regression, and private stream URL rejection.
- Release manifest generation now uses Windows-safe path handling and includes `recovered_src/` and `scripts/`.

## Validation Run

All commands used the bundled Node executable:

```powershell
$node = 'C:\Users\mkang\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node --check scripts/release-manifest.mjs
& $node --check dist/assets/index-CosF9-ak.js
& $node --check dist/assets/metadata-enrichment.js
& $node --check server/metadata-providers.mjs
& $node --check server/metadata-api.mjs
& $node --check server/desktop-proxy.mjs
& $node --check electron/main.mjs
& $node --check electron/preload.cjs
& $node tests/smoke-metadata.mjs
& $node tests/smoke-desktop.mjs
```

Result:

```text
metadata smoke checks passed
desktop smoke checks passed
```

## Not Run

- `npm install`, `npm ci`, and `npm run smoke`: npm is not available in this environment.
- `npm run dist:desktop`: electron-builder cannot run without npm-installed dependencies.
- TypeScript rebuild from `recovered_src/`: this package contains recovered source and a patched runtime bundle, not a full Vite/TypeScript project scaffold.

## Next Commands When npm Is Available

```powershell
npm ci
npm run smoke
npm run dist:desktop
npm run release:manifest
```

If no lockfile exists yet, run `npm install` once in a controlled build environment, review the generated lockfile, then use `npm ci` for repeatable builds.

## Rollback

- Restore from `C:\Users\mkang\Downloads\EarthRadio-0.24.0-desktop-metadata-source-ready.zip`.
- Re-run `scripts/release-manifest.mjs` after restore.

## Risks / Notes

- `dist/assets/index-CosF9-ak.js` was patched directly because no full renderer build toolchain was present.
- `dist/assets/index-CosF9-ak.js.map` was not regenerated.
- Spotify remains server-side only and requires `SPOTIFY_CLIENT_ID` plus `SPOTIFY_CLIENT_SECRET` at runtime.
