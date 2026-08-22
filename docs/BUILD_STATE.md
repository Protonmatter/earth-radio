# Build state

Status date: 2026-08-22. Candidate version: `0.24.0-recovered.1`.

## Validated

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
- The public repository is `https://github.com/Protonmatter/earth-radio`. Remote GitHub Actions CI passed on Ubuntu and Windows for `941df96c2c83aacd65af94fa8f511ccee1760189` at https://github.com/Protonmatter/earth-radio/actions/runs/32585713176.

## Not validated

- Cloudflare build/deployment behavior and the intended hostname have not been validated.
- Desktop installer creation, launch/runtime behavior, Authenticode signing, installation, upgrade, and rollback have not been validated from this recovered repository. The unpacked packaging candidate is unsigned and uses Electron's default icon.
- Live station behavior depends on current third-party catalogs, CORS, codecs, and stream uptime. Direct iTunes metadata lookup returned HTTP 403 for one raw station label during smoke testing and degraded to raw ICY metadata as designed.
- The recovered TypeScript tree is not proven to rebuild the selected installed hashed JavaScript bundle.

## Live deployment

Not created. `https://earth-radio.pages.dev` is an intended URL only and must not be described as live until a Cloudflare deployment succeeds and its served commit/assets are independently verified.
