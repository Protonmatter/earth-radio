# Earth Radio 0.31.0 qualification

This release targets the five directory/search/map findings in the November 8
review. Its architecture, limits, data provenance and rollback are documented in
[DISCOVERY_RELIABILITY.md](DISCOVERY_RELIABILITY.md).

Local full verification passed 490 tests with three environment-dependent skips,
including metadata/desktop smokes, lint, coherent module versions, static-site and
website validation, and deterministic source hashes. Focused adversarial tests
cover country-code alias collisions, malformed mixed-country batches before a
configured limit, protected place/genre terms, cache failures and deadlines,
late provider resets, body-size caps, stale refresh and conditional ETags.
The independent review's two final P2 findings were reproduced, corrected and
read back with 23 focused cases passing.

The final local repeat passed all 149 Chromium/WebKit browser cases, the 42-scenario
rendered matrix, seven standalone directory/HLS/navigation cases, and Windows ARM64
renderer/auth/lifecycle gates. The dependency audit reported zero vulnerabilities.
These local results precede the separately recorded hosted/live/artifact checks.

Required publication gates remain:

```powershell
npm run verify
npm run test:e2e -- --workers=3
npm run test:rendered
node --test tests/directory-expansion.test.mjs tests/hls-fixture.test.mjs tests/player-navigation.test.mjs
npm run test:desktop-renderer
npm run test:desktop-auth
npm audit --audit-level=moderate
```

The browser suite covers one-request same-origin cold boot at phone and desktop
widths, directory fallback/retry, country expansion, exact and corrected search,
filters, map labels/tooltips, approximate-location disclosure, HTTPS favicon
fallbacks, account/song behavior and installed Chromium offline reload. WebKit
automation is a browser-engine check, not physical iPhone Home Screen evidence.

A live Windows private-proxy probe on November 8 loaded 3,305 stations from 129
countries in 3.36 seconds. Running the maintained ranker on that raw catalog put
FEBC Seoul first for `seoul`, corrected `classicl` to `classical`, and returned US
news for `미국 뉴스`. This is one network/catalog observation, not a packaged UI
latency benchmark or an audio-availability qualification. The 94.3% shell reduction
compares referenced precache file bytes, not network timings.

Hosted acceptance must exercise a real Cloudflare preview's complete cold/warm
snapshot bodies, ETags, method/path/query restrictions and targeted country data,
then verify all ten exact-head checks before merge. Final production origin hashes,
header policies, preserved original-account session, desktop payload/source matches,
signature and DMG checks, all release-asset checksums and anonymous downloads belong
in release provenance and the existing Spaces operations record after publication.

Provider, account and cloud-document code is unchanged. The live Google/email
native return, restart and cross-browser sync evidence remains the dated
[v0.30.0 qualification](QUALIFICATION-0.30.0-LIVE.md); synthetic native tests do not
replace it. No identity linking/reset, SMTP change, new provider scope or credential
operation is required for this release.

Physical iPhone/iPad installation/account return for this release, physical Mac
installation/upgrade, original-profile Windows installer upgrade, screen-reader
behavior, all-station availability and human audio fidelity remain unqualified.
Windows uses the accepted local signer without public publisher trust. macOS builds
remain ad-hoc signed and explicitly unnotarized. No paid qualification service or
new dependency is configured.
