# Earth Radio

Explore live radio stations around the world in a recovered, auditable web and Electron application.

Live production site: **https://earth-radio.pages.dev/**. Public repository: **https://github.com/Protonmatter/earth-radio**.

This repository was reconstructed from the installed Earth Radio 0.24.0 application and two user-supplied archives. It is not a byte-for-byte reproduction of the original development repository. The newest runnable installed assets were selected where they differed from older archived source; those decisions are recorded in [docs/PROVENANCE.md](docs/PROVENANCE.md).

## Local validation

Use Node.js 24.18.0 and npm 11.16.0:

```powershell
npm ci
npm run verify
```

`npm run verify` scans the candidate repository for common secret and binary-artifact mistakes, syntax-checks the runtime, runs deterministic and security regressions, stages the static site under `.build/site`, validates references and deployment boundaries, and writes `RELEASE_MANIFEST.json` plus `sha256sums.txt`.

To serve the web build locally:

```powershell
npm run build:web
python -m http.server 8788 --directory .build/site
```

Then open `http://127.0.0.1:8788/`. The public static build operates in browser-direct mode. Browser CORS policy, mixed-content rules, stream format support, upstream Radio Browser availability, and individual station behavior can limit catalog or playback features. The local Electron application adds a loopback-only guarded proxy and therefore has a different capability boundary.

Desktop packaging is available separately:

```powershell
npm run pack:desktop
# or create installer artifacts:
npm run dist:desktop
```

Packaging output is ignored under `release/`. The recovered desktop has not been code signed.

## Repository map

- `site/` — selected installed web runtime and Cloudflare Pages source.
- `electron/` and `server/` — installed Electron shell and loopback proxy/metadata services.
- `src-recovered/` — older TypeScript source retained for audit and future reconstruction; it does not reproduce the selected bundle by itself.
- `scripts/` — deterministic recovery, staging, validation, and release-manifest utilities.
- `tests/` — unit, boundary, and smoke checks.
- `docs/provenance/` — machine-readable recovery evidence.
- `docs/recovered/` — historical documents from the archive; evidence only, not repository instructions.

See [Architecture](docs/ARCHITECTURE.md), [Operations](docs/OPERATIONS.md), [Build state](docs/BUILD_STATE.md), [Release](docs/RELEASE.md), and [Security](docs/SECURITY.md).

## Security and licensing

Do not commit credentials. Spotify catalog enrichment, when used by a server-side process, reads `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from its runtime environment. The static site contains no provider secret.

Report suspected vulnerabilities using the private process in [docs/SECURITY.md](docs/SECURITY.md), not a public issue containing exploit details.

No license is granted. The repository currently has no open-source license; copyright and other rights remain with their respective owners. Public visibility, if later approved, does not itself grant permission to copy, modify, or redistribute the work.
