# Build state

Status date: 2026-08-23. Candidate version: `0.24.0-recovered.1`.

## Validated

- The additive Atlas Editorial layer, six structurally complete UI catalogs, destination/split/collapse contract tests, and service-worker cache-version checks pass locally via `npm run verify`. Localization updates attributes or visible text, not both, so play/search glyphs remain. Engineering-authored catalogs are identified as such.

- Both supplied ZIP inputs were hashed and inventoried; recovery selection is captured in `docs/provenance/recovery-manifest.json`.
- The installed executable reports Earth Radio 0.24.0 and is not Authenticode signed.
- Locked dependency installation completed with Node.js 24.18.0 and npm 11.16.0.
- Repository safety, JavaScript syntax, deterministic inventory/staging/manifest, static-boundary, metadata, and desktop proxy checks pass locally.
- Desktop proxy regression checks cover per-launch route authorization, Origin enforcement, IPv4-mapped IPv6 normalization, carrier-grade NAT blocking, and DNS rebinding defenses.
- The Electron entry point and packaging configuration both target the selected `site/` directory.
- Static output validation rejects localhost proxy configuration, missing assets, source-map files or references, and files outside the allowlisted publish boundary.
- Local CI policy validation confirms Linux/Windows jobs, read-only permissions, no secret references, and immutable action pins.
- A Chromium smoke test against `.build/site` loaded 3,912 current Radio Browser stations, exercised command-palette search and filters, restored the last station/catalog from local persistence after reload, activated `sw.js`, and played the HTTPS 320 kbps MP3 stream for Classic Vinyl HD on 2026-08-22.
- The browser audit found and verified a repair for late service-worker registration; the post-fix reload had one active controlling worker and zero console errors/warnings.
- `npm run pack:desktop` produced a Windows ARM64 unpacked application; ASAR inspection confirmed `electron/proxy-rules.mjs`, `server/desktop-proxy.mjs`, and `site/index.html` are present, while `server/example-proxy.mjs` and production `node_modules/` are absent. The packaged executable SHA-256 was `5FE78FC3C3E533A2C123E9600EC821CD7E0AD2DA496277DB53FB2061BF4356B9`.
- The public repository is `https://github.com/Protonmatter/earth-radio`. Pull request #3 merged the cache-upgrade fix into `main` as `308e8e166237f556e081bdd02395d298de842b6a`.
- GitHub Actions CI passed on Ubuntu and Windows for merge commit `308e8e166237f556e081bdd02395d298de842b6a` at https://github.com/Protonmatter/earth-radio/actions/runs/32621297942.
- Cloudflare Pages production deployment `ef9d01f4-0471-4a66-a086-25b4e4579474` succeeded for the merge commit. All 22 public files in the generated asset manifest matched the files at `https://earth-radio.pages.dev/` by byte length and SHA-256.
- Live cache headers grant one-year immutable caching only to the hashed runtime assets. Maintained overlays, `config.js`, and `i18n/*` revalidate after five minutes. `sw.js` is `no-cache` and serves `earth-radio-shell-v25-responsive-7` with reload-on-install.
- A public Chromium catalog/search smoke was recorded against the previous production baseline on 2026-08-23 and was not re-captured after this cache-policy deploy. File identity, cache headers, and service-worker source were re-verified from the live origin.

## Not validated

- Desktop installer creation, launch/runtime behavior, Authenticode signing, installation, upgrade, and rollback have not been validated from this recovered repository. The unpacked packaging candidate is unsigned and uses Electron's default icon.
- Live station behavior depends on current third-party catalogs, CORS, codecs, and stream uptime. Direct iTunes metadata lookup returned HTTP 403 for one raw station label during smoke testing and degraded to raw ICY metadata as designed.
- The recovered TypeScript tree is not proven to rebuild the selected installed hashed JavaScript bundle.
- Physical iOS Safari, installed-PWA, VoiceOver, and native-speaker editorial review of the six UI catalogs have not been captured. Catalogs are engineering-authored.

## Live deployment

Production is live at `https://earth-radio.pages.dev/`. The verified baseline is merge commit `308e8e166237f556e081bdd02395d298de842b6a`, GitHub Actions run `32621297942`, and Cloudflare Pages deployment `ef9d01f4-0471-4a66-a086-25b4e4579474`.

File identity and cache policy were re-verified after this deployment. Physical iOS Safari, installed-PWA behavior, VoiceOver, native-speaker translation review, and every third-party station stream remain outside the verified production scope.
