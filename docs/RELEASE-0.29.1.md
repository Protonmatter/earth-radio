# Earth Radio 0.29.1 public website and domains

This patch introduces the product/download website at `earthradio.stream` and the
primary radio application at `app.earthradio.stream`. The earlier pages.dev app
remains usable. Auth admits only the exact new and legacy web origins while keeping
native PKCE returns. Existing account identities, provider grants, sender configuration,
station discovery and the compact player/song library retain their contracts.

The website is a separate static Pages project from the same repository. It uses
real product screenshots, responsive typography, accessible navigation, free listening
entry points, desktop release links, and Safari Home Screen installation instructions.
No new dependency, telemetry, subscription or map service is added. See
[domain operations and rollback](DOMAINS.md) and [installation](INSTALLATION.md).

Versioned mutable modules and shell `earth-radio-shell-v63-public-domains` prevent
old service-worker imports from mixing releases. Final main must pass existing local,
browser, native and Supabase gates plus website/origin tests before production.
Both Pages deployments and desktop payloads must match that source. Published release
provenance carries source, CI, deployment identities and verified artifact checksums.
Do not modify existing v0.29.0 assets. Windows retains local signing; macOS remains
ad-hoc signed and explicitly unnotarized. Physical device and public publisher-trust
qualification remain bounded as documented in [qualification](QUALIFICATION-0.29.1.md).
