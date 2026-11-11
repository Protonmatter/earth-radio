# Earth Radio

Explore live radio stations around the world in a recovered, auditable web and Electron application.

Release **[0.32.2 is published](https://github.com/Protonmatter/earth-radio/releases/tag/v0.32.2)**. It keeps explicit station playback within its program, reports directory clicks only after confirmed audio, serves real online/offline 404s, and adds Windows x64 alongside ARM64 and both macOS architectures. All six application builds match the qualified source; all thirteen draft and anonymous public downloads passed full size/SHA-256 verification. See the [release record and qualification limits](docs/RELEASE-0.32.2.md). Grouped streams, the normalized scheduled directory and approved identity are retained. The website stages fallback download links from the verified published-release metadata.

Website and downloads: **https://earthradio.stream/**. Radio app: **https://app.earthradio.stream/**. The earlier **https://earth-radio.pages.dev/** app remains available for existing shortcuts and unsynced local collections. Public repository: **https://github.com/Protonmatter/earth-radio**.

See the [installation guide](docs/INSTALLATION.md) for Windows ARM64/x64, macOS Apple Silicon/Intel, and Safari Home Screen installation on iPhone/iPad. Get desktop downloads, checksums and build provenance from the [latest complete release](https://github.com/Protonmatter/earth-radio/releases/latest). Windows uses the accepted local signer; macOS builds are explicitly labeled unnotarized.

This repository was reconstructed from the installed Earth Radio 0.24.0 application and two user-supplied archives. It is not a byte-for-byte reproduction of the original development repository. The newest runnable installed assets were selected where they differed from older archived source; those decisions are recorded in [docs/PROVENANCE.md](docs/PROVENANCE.md).

## Local validation

Use Node.js 24.18.0 and npm 11.16.0:

```powershell
npm ci
npm run release:manifest
npm run verify
```

`npm run release:manifest` writes `RELEASE_MANIFEST.json` and `sha256sums.txt` after source changes settle. `npm run verify` scans the candidate repository for common secret and binary-artifact mistakes, syntax-checks the runtime, runs deterministic and security regressions, stages the static site under `.build/site`, validates references and deployment boundaries, and fails without rewriting files when either committed release artifact is stale.

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

Packaging output is ignored under `release/`. Windows targets produce distinct `EarthRadio-Setup-*` and `EarthRadio-Portable-*` executables. A process-local packaging hook pins a legacy-compatible BCJ archive filter for the bundled NSIS decoder; both targets use 7z so their shared package cache has one format. The 0.26.0 ARM64 release uses local self-signed Authenticode signatures and DigiCert timestamps. Public Windows trust remains deferred by the user's decision; a normal build does not automatically select this machine's certificate. See the [0.26.0 release record](docs/RELEASE-0.26.0.md) for artifact provenance and qualification boundaries.

The new globe/radio icon was generated with ChatGPT. Its master, exact prompt, hash and deterministic derivatives are recorded in [icon provenance](docs/branding/ICON.md).

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
