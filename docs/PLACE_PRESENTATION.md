# Place-first facts and ownership

The ER-05 candidate builds on deployed Today 0.33.1, main
`3ebd300af6d4189d3be3ee40e3f31f9560291b54`. Candidate 0.34.0 uses coherent
module URLs and worker `v76-place-first`. Rows, player facts and map tooltips
share one conservative copy model; the audio, catalog, account and sync owners
remain authoritative. See [the delivery plan](superpowers/plans/2026-11-11-place-first.md)
and [candidate qualification](QA-0.34.0.md) for release state.

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

## UI ownership

`place-ui.js` marks player facts and retains bounded raw ICY input separately.
The metadata extractor reads that explicit signal and never treats the displayed
country, genre or clock as a song. A late stream probe can fill missing raw input,
but cannot replace a live title. Selecting a different identity clears old input.
Existing higher-trust freshness, source fencing and song-history gates remain.

Minute, foreground and locale updates touch only registered visible facts. A
clock refresh cannot overwrite the failed-player message or trigger song lookup.
The existing stream selector now lives in Details with format, bitrate,
connection, directory score, sources and location evidence. Selection still
belongs to the original group owner, with no autoplay; Resume uses that choice.
An HTTP stream retains a localized Desktop hint in web rows and protocol detail
inside Details. Original diagnostic nodes live in Settings, while actionable
playback and load recovery stay visible. Compact palette country scope uses
canonical country codes, and explicit Refine filters remain functional.

Clocks have a reserved inline space beside ellipsized place/genre text, including
at 320px. Full text remains in the title attribute. Details uses the existing
dialog, returns focus to the refreshed row and has a logical close-button inset
for right-to-left locales. Closing an automatically opened account-error dialog
falls back to visible Library navigation when its original trigger is hidden.

## Validation and rollback

```powershell
node --test tests/place-copy.test.mjs tests/place-metadata.test.mjs tests/place-core.test.mjs tests/i18n-catalogs.test.mjs
npm run verify
npm run test:e2e -- --workers=3
npm run test:rendered
npm run test:desktop-renderer
npm run test:desktop-auth
```

Tests cover city/country fallback, native conflicts, six locales, explicit clocks
including DST, malformed tags and fields, and input immutability. Removing this
helper does not migrate or clear user data. Roll back a complete deployment and
advance cache identity; preserve existing releases. Do not revert only the
metadata marker while retaining the changed player text.

The inactive core passed 658 tests with three existing Windows skips and 430
source hashes. Current UI, hosted and desktop artifact qualification are recorded
separately; source tests do not qualify physical devices or published downloads.
