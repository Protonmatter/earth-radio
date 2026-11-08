# Earth Radio 0.30.0 qualification

See the [November 8 live Windows and WebKit follow-up](QUALIFICATION-0.30.0-LIVE.md)
for native provider/sync/restart results, the website keyboard fix and the pending
physical iPhone Home Screen checklist. These dated results extend the release
checks below without replacing the immutable v0.30.0 artifacts.

Required local gates: `npm run verify`, `npm run test:e2e`,
`npm run test:rendered`, `npm run test:desktop-renderer`,
`npm run test:desktop-auth` and `npm audit --audit-level=moderate`.

The search regression exercises shared queries/ranking, rapid Enter, composition,
pending text during directory refresh, country code scope/expansion, facets with
2,500 categories, unavailable selections, filter-chip removal after input blur,
query-preserving recovery, normalized region/format/language metadata, legacy
quality filters, no autoplay and readable rows after 320/390/1440px transitions.
Existing station/map/playback/account/song tests must also pass. A real browser
must inspect live directory results and popup geometry at desktop and phone widths.

Final delivery evidence belongs in BUILD-PROVENANCE.json and Spaces after exact-head
CI, both production artifact/header readbacks, packaged-source comparison, signature/
DMG checks and full anonymous download hashes. Fixture playback establishes interaction
behavior, not station uptime or audio fidelity. Prior live Google/email qualification
is a dated account result, not a new test of every provider or signup combination.

Physical iPhone/iPad Home Screen behavior for this release, physical Mac install/
upgrade, all station availability and human audio fidelity are not established by
automation. Windows retains the accepted local signer without public publisher trust;
macOS is ad-hoc signed and unnotarized. No new paid qualification service is configured.

Local results, November 8: 458 tests passed with three platform skips; metadata/
desktop smokes, 103 Chromium E2E cases, 42 rendered scenarios, seven focused
directory/HLS/navigation cases, Windows renderer/auth/lifecycle and recovery-import
smokes passed. Dependency audit reported zero vulnerabilities. Live local browser
checks found France-only jazz results and New Zealand coverage from the full index;
390px rows measured 349px wide with 199px text bodies, no overflow or autoplay.
The final review found no P0-P2 blocker after reset, async-highlight and current-code
fixes; the minor stale active-descendant finding was corrected and browser-tested.
Publication/packaged identities still require their separate delivery receipts.
