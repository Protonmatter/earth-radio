# Architecture

Earth Radio has three deliberately separate execution boundaries.

## Public static web

Cloudflare Pages, if later created, serves only the deterministic `.build/site` output produced from `site/`. The browser loads the station catalog and compatible HTTPS streams directly from public upstream services. No server code, Electron code, recovered TypeScript, tests, documents, source maps, local paths, or secrets are copied into the publish directory.

The service worker caches versioned application assets. `_headers` supplies defensive browser headers. Static hosting cannot bypass upstream CORS, mixed-content, codec, or station availability constraints.

## Local Electron desktop

`electron/main.mjs` creates a sandboxed window with context isolation, Node integration disabled, navigation blocked, and external HTTP(S) links opened by the operating system. `electron/preload.cjs` exposes only the narrow proxy/configuration bridge required by the renderer.

The desktop process starts `server/desktop-proxy.mjs` on an ephemeral IPv4 loopback port and exposes API routes only beneath a cryptographically random per-launch capability path injected through the preload bridge. API requests require an allowed origin; the Electron `file://` renderer’s `Origin: null` is accepted only when that capability path is also present. Untrusted browser origins and unauthenticated raw-origin requests are rejected. Stream targets are normalized across IPv4, IPv6, and IPv4-mapped/compatible IPv6 forms. Private, loopback, link-local, multicast, unspecified, and CGNAT (`100.64.0.0/10`) targets are rejected during initial resolution and rechecked by the pinned connection lookup. This compensates for browser-only CORS limitations without creating a network-accessible open proxy.

Metadata identification is server-side. iTunes lookup needs no credential. Optional Spotify lookup reads credentials only from the process environment. Identification results are confidence-scored, explain reasons, preserve raw ICY metadata, and use a bounded in-memory cache.

## Recovered source and provenance

`src-recovered/` is an older source snapshot selected from the hardened archive. It is useful for maintenance intent and domain logic but does not compile to the selected installed hashed bundle without the missing original toolchain/state. `docs/recovered/` has the same evidence-only status.

The selected runnable web, Electron, and server files came from the installed 0.24.0 application. `scripts/Import-EarthRadioRecovery.ps1` implements the selection rules and emits `docs/provenance/recovery-manifest.json`.

## Excluded future boundary

A Cloudflare Worker or other public proxy is not part of this build. Publishing the desktop proxy would materially enlarge the abuse and SSRF surface and would require authentication, rate limits, quotas, egress policy, logging, abuse response, and separate review. No such service should be inferred from the Pages design.
