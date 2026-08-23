# Architecture

Earth Radio has three deliberately separate execution boundaries.

## Public static web

Cloudflare Pages, if later created, serves only the deterministic `.build/site` output produced from `site/`. The browser loads the station catalog and compatible HTTPS streams directly from public upstream services. No server code, Electron code, recovered TypeScript, tests, documents, source maps, local paths, or secrets are copied into the publish directory.

The service worker caches versioned application assets. Its install requests use `cache: 'reload'` so a new cache generation cannot be seeded from an obsolete browser HTTP cache. If that reload fails, the previous worker and cache remain active. `_headers` grants one-year immutable caching only to eight-character content-hashed runtime assets; maintained responsive and metadata overlays revalidate after five minutes. The staged-site validator rejects immutable caching inherited by any deployed non-fingerprinted file. Static hosting cannot bypass upstream CORS, mixed-content, codec, or station availability constraints.

An additive Atlas Editorial presentation layer (`site/assets/responsive-ui.css`, `site/assets/responsive-ui.js`, and `site/i18n/*`) loads after the recovered hashed runtime. It owns mobile destinations, Now Playing visibility, desktop split/collapse, and locale chrome. Catalog, playback, favorites, filters, metadata, and the Leaflet map remain runtime-owned. Presentation destinations persist in `earthRadio.ui.v1` and do not overwrite runtime `station`/`view` hashes. `data-i18n-attr` localizes only the named attribute so transport and header glyphs stay intact. The recovered virtualizer keeps its 168px cell height; mobile rows expose a 64px minimum and 44px play targets. Chinese locale IDs stay `zh-Hans` and `zh-Hant`. Electron’s minimum window remains 1080×720, so the desktop split is the Electron layout; mobile navigation appears only at or below 767px.

## Local Electron desktop

`electron/main.mjs` creates a sandboxed window with context isolation, Node integration disabled, navigation blocked, and external HTTP(S) links opened by the operating system. `electron/preload.cjs` exposes only the narrow proxy/configuration bridge required by the renderer.

The desktop process starts `server/desktop-proxy.mjs` on an ephemeral IPv4 loopback port and exposes API routes only beneath a cryptographically random per-launch capability path injected through the preload bridge. API requests require an allowed origin; the Electron `file://` renderer’s `Origin: null` is accepted only when that capability path is also present. Untrusted browser origins and unauthenticated raw-origin requests are rejected. Stream targets are normalized across IPv4, IPv6, and IPv4-mapped/compatible IPv6 forms. Private, loopback, link-local, multicast, unspecified, and CGNAT (`100.64.0.0/10`) targets are rejected during initial resolution and rechecked by the pinned connection lookup. This compensates for browser-only CORS limitations without creating a network-accessible open proxy.

Metadata identification is server-side. iTunes lookup needs no credential. Optional Spotify lookup reads credentials only from the process environment. Identification results are confidence-scored, explain reasons, preserve raw ICY metadata, and use a bounded in-memory cache.

## Recovered source and provenance

`src-recovered/` is an older source snapshot selected from the hardened archive. It is useful for maintenance intent and domain logic but does not compile to the selected installed hashed bundle without the missing original toolchain/state. `docs/recovered/` has the same evidence-only status.

The selected runnable web, Electron, and server files came from the installed 0.24.0 application. `scripts/Import-EarthRadioRecovery.ps1` implements the selection rules and emits `docs/provenance/recovery-manifest.json`.

## Excluded future boundary

A Cloudflare Worker or other public proxy is not part of this build. Publishing the desktop proxy would materially enlarge the abuse and SSRF surface and would require authentication, rate limits, quotas, egress policy, logging, abuse response, and separate review. No such service should be inferred from the Pages design.
