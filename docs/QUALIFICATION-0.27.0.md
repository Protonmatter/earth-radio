# Earth Radio 0.27.0 qualification

This release changes presentation and list sizing while retaining the 0.26.0
directory, playback, account, encrypted-session and synchronization contracts.
The source and release processes are described in [release gates](RELEASE-0.27.0.md).

## Station loading and finding

`tests/e2e/station-loading.spec.mjs` introduces a deterministic 500-station directory
and exercises an explicit network refresh, discovery of an offscreen station,
phone-to-desktop resize, zero-match recovery, end-of-list playback selection, and
directory recovery after reload with its source unavailable. Existing regressions
cover country expansion, map-area searches outside the initial German sample,
retry after directory failure, malformed optional metadata, deduplication,
cancelled requests, IME composition and similar-station ranking updates.

The compact-row test covers 320/390/1440px layouts, one-column/nonoverlap geometry,
44px playback/favorite controls, retained quick-pick handlers and Night persistence.
The 42-scenario Electron matrix covers safe areas, RTL/locales, zoom, dialogs,
keyboard navigation and split sizing. Each scenario starts with a fresh test
database. Playback helpers wait for settled application state before the next
transport command; exposed map markers are selected using browser hit testing.

## Release evidence

Run the documented local checks and all exact-head hosted CI checks. The CI matrix
includes Windows and macOS native sandbox/auth tests, both Mac DMG builds, Linux
and Windows repository checks, browser tests, database/RLS tests and local auth
integration. Rebuild Windows from the final clean source and record package/source
hash comparisons, architecture, signature/timestamp limits and startup receipts.
Validate production against the staged manifest and download the release assets
without authentication to verify their full sizes and SHA-256 values.

Retained diagnostic artifacts are ignored under `.build/desktop-release-0.27.0/`.
The published release provenance and private Spaces operations record contain the
final source commit, CI run IDs, deployment identity and measured results. This
document specifies the qualification scope rather than claiming that a merge or
an artifact upload alone establishes production acceptance.

## Live and physical boundaries

Bounded live Radio Browser and MP3/AAC checks use the existing public-network guard
and codec-analysis diagnostic. No audio clips or raw endpoint queries are retained.
Decoded non-silent samples establish that those sampled endpoints responded at
that time; they do not establish future availability or perceptual/device fidelity.
Live OAuth and email configuration are not changed. The prior native account
qualification remains in [0.26.0 evidence](QUALIFICATION-0.26.0.md). Fresh outside-team
provider identities, physical Mac installation/upgrade, installed iOS/iPadOS account
returns and publicly trusted desktop signing remain separately qualified limits.
