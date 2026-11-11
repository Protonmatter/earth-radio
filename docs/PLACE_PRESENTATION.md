# Place-first facts and ownership

The inactive core on the ER-05 branch builds on deployed Today 0.33.1, main
`3ebd300af6d4189d3be3ee40e3f31f9560291b54`. It adds a pure helper and two static
labels in each locale. Active rows, audio, tooltips, metadata and account entry
points remain unchanged until the separate UI integration. The design and task
boundaries are in [the plan](superpowers/plans/2026-11-11-place-first.md).

## Copy contract

`stationFacts(station, {locale = 'en', now} = {})` returns
`{place, genre, time, text, cityId}`. A city requires the existing conservative
`stationPlace` evidence. A valid native full-root component record may restrict
that city; it cannot confer city evidence on an unsupported variant. Country
fallbacks, conflicting explicit cities and invalid coordinates yield Country
alone, with no genre or clock. Unknown country has a localized plain fallback.

Known cities use short localized country names, the first bounded non-generic
directory genre tag through existing normalization, and explicit-instant IANA
time when available. The helper performs no I/O, storage, implicit Date.now or
mutation. It does not change station identities, rank, search filters or data.
It returns plain text; consumers must use text assignment, not HTML insertion.

City names and timezone identifiers remain the small source-backed model, not a
new geocoder. Native metadata only restricts qualification. Host Intl supplies
the timezone rules; the pinned identifier data do not bundle clock rules. Genre
tags are directory metadata, not an independently calibrated classification.

## UI integration requirements

The next task must retain explicit raw ICY input separately from place facts.
The current extractor uses codec/bitrate tokens to avoid treating station facts
as a song; removing those tokens without a marker would be a regression. Keep
higher-trust metadata freshness, source fencing and song-history behavior.

Clock updates must only touch registered visible nodes. Move the original stream
selector to Details without autoplay or loss of UUID/alias, Resume, favorites,
retry or focus behavior. Retain meaningful web playability guidance. Move the
original diagnostic nodes to Settings and keep failure recovery visible. Compact
palette country scope and explicit Refine filters remain functional.

This task does not ship a new UI. Integration requires fresh 0.34.0 URLs/v76,
all existing browser/rendered/native gates, independent review and actual served
qualification. The final phase3 desktop release is separate and immutable.

## Validation and rollback

```powershell
node --test tests/place-copy.test.mjs tests/place-core.test.mjs tests/i18n-catalogs.test.mjs
npm run verify
```

Tests cover city/country fallback, native conflicts, six locales, explicit clocks
including DST, malformed tags and fields, and input immutability. Removing this
inactive helper does not migrate or clear user data. Once integrated, revert a
complete deployment and advance cache identity; preserve existing releases.

The inactive core passes 658 tests with three existing Windows skips and 430
source hashes through the full repository verifier. The 14 focused copy/catalog
checks pass. This does not qualify the later UI integration or new desktop files.
