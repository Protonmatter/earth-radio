# Earth Radio v0.34.1

[Published release](https://github.com/Protonmatter/earth-radio/releases/tag/v0.34.1) · 2026-11-12T02:39:11Z · release 442427866.

The palette keeps typed text and composition in the visible search field. The
internal query bridge stays available; station ranking, playback intent,
collections and account ownership are preserved. A separate test correction
waits for actual durable history-off acknowledgement before reload. Product
storage/privacy logic is unchanged.

Source: `8b6875a5fcd299e0af6df8d12cd5fb82af23acd8`. Annotated tag object: `e52196bd01d05d3bdc24bfd7cdeed9f51a9d7315`.
All six builds match 128 application files plus the production package metadata.
The four Windows files additionally match 87 physical payload files per package
and pass local signer, CMS signature, bound RFC3161 timestamp and startup checks.
Both native Mac CI DMGs pass read-only mount/icon/startup checks and independent
ASAR/source/metadata comparison. Both Windows portable guests pass native search,
HTTPS filter recovery, muted live playback, favorite/volume retention and two
normal quits, with no autoplay after restart.

All 13 draft downloads and all 13 anonymous public downloads passed complete size
and SHA-256 checks; SHA256SUMS.txt covers the other 12 release assets. The exact
public INSTALL.md is also [the current repository installation guide](INSTALLATION.md).
[Build/download receipt](provenance/release-0.34.1.json) records IDs and hashes.

CI: reviewed head and final main each pass ten checks and 341 browser cases with
zero flaky results. Local verification passed 679 tests with three existing Windows skips, 42 rendered
contracts, native auth/restart/lifecycle, installed-worker upgrade/offline and
448 canonical source hashes. Actual served bytes/headers/routes/UI/focus
and live directory acceptance passed; these do not establish physical devices
or fresh provider identities.

- Windows uses the accepted local Authenticode signer; public publisher trust is not provided. macOS is ad-hoc signed and explicitly unnotarized.
- Windows x64 executes here under Windows ARM emulation; installer extraction is not installer/upgrade execution on physical Intel/AMD hardware.
- Native CI and controlled browser tests do not establish fresh provider/signup acceptance, physical iPhone/PWA/Mac installation, physical OS IME behavior, screen-reader acceptance or human audio fidelity.
- Directory city minima count metadata programs, including HTTP streams; station availability and hourly data can change. Guest snapshot observations are separately dated.

Prior 0.32.1, 0.32.2 and 0.34.0 tags/assets retain their identities and hashes.
Rollback selects a complete prior deployment/package without replacing tags or
assets or clearing user profiles. A forward app correction must advance the
worker cache identity. The website/download metadata follow-up is separate from
this immutable release and requires its own CI and actual served acceptance.
