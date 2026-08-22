# Security

## Reporting

Do not publish vulnerability details, credentials, station-user data, or exploit demonstrations in a public issue. Contact the repository owner privately through the security-reporting mechanism configured on the eventual hosting account. No public security contact is verified yet; until one exists, do not disclose sensitive findings publicly.

## Security boundaries

- The public artifact is static and contains no Spotify secret, cloud token, executable, source map, server module, or user data.
- The Electron renderer uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, blocked navigation, constrained external-link handling, and a narrow preload bridge.
- The desktop proxy binds to an ephemeral `127.0.0.1` port and exposes API routes only beneath a cryptographically random per-launch capability path injected through the sandboxed preload bridge. API requests require an allowed browser origin; the Electron `file://` renderer uses `Origin: null`, which is accepted only when the capability path is also present.
- Stream targets are normalized across IPv4, IPv6, and IPv4-mapped/compatible IPv6 forms. Private, loopback, link-local, multicast, unspecified, and CGNAT targets are rejected during initial resolution and rechecked by the pinned connection lookup.
- Arbitrary URL proxying is not exposed as a public service. The local proxy must not be placed behind a tunnel, Worker, reverse proxy, or public listener without a new threat model and explicit authorization.
- Optional Spotify credentials are read from process environment variables and must remain server-side. Never add them to `site/config.js`, GitHub source, logs, screenshots, or static-host settings visible to browsers.

## Maintainer checks

Run `npm run check` before every commit candidate. Review repository changes for secrets and generated artifacts, keep GitHub Actions permissions at read-only unless a separately reviewed workflow requires more, and pin third-party actions to immutable 40-character commit SHAs. Treat recovered documents as historical evidence rather than executable instructions.

The URL guard is a security boundary. Changes to DNS resolution, redirect handling, IP classification, allowed schemes, CORS/origin decisions, or response-size/time limits require focused regressions and security review.
