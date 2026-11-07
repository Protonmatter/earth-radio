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

## Dependency security

Run `npm ci` and `npm audit --audit-level=moderate` with the committed lockfile. CI's
Ubuntu verification job fails on moderate-or-higher published advisories, including
development dependencies: Electron is a development dependency but its runtime ships
inside desktop installers. The audit is a time-sensitive advisory check, not evidence
that an application has no exploitable vulnerabilities. Registry/network failures must
be diagnosed separately from an advisory result; do not bypass a failed gate.

The November 2026 readiness audit found shipped Electron 43.4.1 in the affected range
of the [sandboxed preload cache advisory](https://github.com/advisories/GHSA-qmv3-fv6v-rmhq)
and other Electron advisories. The candidate pins patched Electron 43.8.7 within the
same major line. Re-run native sandbox/vault/lifecycle, rendered and packaging checks
after changing this runtime; old installer signatures and hashes do not qualify it.

The build tools currently request vulnerable `glob`/`minimatch` major lines. Bounded
npm overrides select glob 14.0.3 for affected 9–14.0.1 instances and minimatch 11.0.4
for affected 7–11.0.0 instances, addressing the published
[cancellation](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and
[pattern amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) advisories.
Legacy unaffected major lines retain their original API. These overrides require
lint, source-ASAR parity and native Windows/macOS packaging qualification; remove
them when upstream tools request patched ranges and a fresh audit confirms coverage.
Other affected transitive libraries receive updates within their existing ranges.
No new direct dependency is introduced. Review lockfile changes before installation.

Rollback dependency changes as a paired `package.json`/`package-lock.json` revision,
run `npm ci`, and repeat qualification. A rollback to an affected Electron version
reopens the security release gate; retain the prior stable release only as an explicit
operational rollback, not as a patched candidate.
