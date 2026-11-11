# Place-first station presentation

The owner approved ER-05 in the daily-return delivery order and delegated design
choices. Build on verified main `3ebd300`: Today 0.33.1 is deployed, all ten head
and main gates pass, and actual account-enabled production UI is qualified.
Desktop v0.32.2 remains immutable until the final phase3 release.

## Purpose and boundaries

Lead station rows, player facts and map tooltips with place. Use the existing
cream, pine and copper identity, typography and layout. Preserve the original
catalog, search, audio, account, sync and metadata owners. No new dependency,
geocoder, data source, permission, paid resource, analytics or notification.

Known cities show `City, Country · genre · local time`. Country names are short
and localized; city names come from the existing corroborated model. If city
evidence is missing or conflicting, show Country alone. Never derive a city or
timezone from a country fallback point. A missing/invalid instant omits the clock.
Keep the compact command palette country-only and preserve country-scoped search.
Existing explicit technical filters remain available in Search's Refine controls;
this change moves station facts, not filtering capabilities.

## Pure copy and clock ownership

`stationFacts(station, {locale = 'en', now} = {})` returns
`{place, genre, time, text, cityId}`. It uses `stationPlace`, `displayCountry`,
existing genre normalization/labels and an explicit instant through the existing
IANA formatter. It has no implicit clock, I/O, storage or input mutation. Reject
malformed/oversized field shapes conservatively and assign all output as text.

`place-ui.js` owns facts presentation only. `createStationFacts(station)` returns
a row node registered in a WeakMap. Minute/foreground refresh updates attached
visible nodes only; it does not format the entire catalog or observe the whole
document. `updatePlayerFacts(station, {rawTitle} = {})` preserves explicit raw title
input for the same station/stream, clears it on identity change, and marks place
facts separately. Clock/locale refresh cannot play, select, report a click, change
history, or initiate a provider lookup.

## Metadata and stream selection

The current metadata extractor distinguishes station facts by codec/bitrate text.
Removing those tokens without an explicit signal could interpret a country as a
song. Add a facts marker and a bounded separate raw-ICY input. Preserve the existing
higher-trust platform/HLS/fingerprint freshness gate, current title/artist parsing,
station fencing and song-history rules. Country/genre/time text must never become
a track or trigger catalog identification. Existing legacy metadata remains usable.

Move the original variant selector into the station Details dialog. Selecting a
variant keeps the original UUID/aliases and does not start audio; Play/Resume uses
that choice. Preserve favorites, sibling recovery and the shared 7.5-second budget.
Show codec, bitrate, connection, score, sources and location provenance in readable
Details facts. Keep the selection focused through refresh and return to a visible
invoker on close. Each row retains its primary play target of at least 44×44px.
Web rows with limited transport get brief human guidance, while protocol details
stay in Details. Do not silently remove the existing playability warning.

## Surface copy and diagnostics

Move the existing directory status and map confidence-counter nodes into Settings
Diagnostics, preserving their IDs and writer ownership. Keep a neutral map station
summary without implying every station has a known studio position. Home, map and
player visible copy avoids snapshot/saved-copy/approximate/unlocated terminology.
Critical catalog and playback recovery remain visible in their existing surfaces.
Tooltips use the same place copy while preserving safe DOM, geometry and lookup
budgets. Add every new static string to all six catalogs.

Also probe the recorded auto-open account-error focus observation: its close
fallback may have no visible target on Today. Fix only if reproduced, using a
visible primary control without changing authentication behavior.

## Integration, validation and delivery

Use narrow recorded hooks in the recovered runtime and mirror their intent in the
reference source. It is still a recovered bundle, not a reproducible compiler
build. Ship coherent 0.34.0 module URLs and worker v76; keep prior immutable runtime
names, tags and desktop assets unchanged. Large map layers stay outside precache.

Preserve all existing search/filter/loading/variant/identity/auth/sync assertions
and numeric layout limits. Add known/unknown/conflicting-city, DST/locale, raw
metadata, no false song/provider work, variant-selection/Resume, Details focus,
diagnostics, tooltips, cached offline and safe-area coverage. Test real visible
controls rather than hidden proxies. Run full verify, browser, rendered and native
gates; get one fresh whole-branch review; require exact-head CI and actual preview
acceptance before merge, then final-main/production checks and Spaces readback.
Build and publish the next immutable Windows/Mac release from final phase3 source
with source/package/signature receipts, checksums and full download verification.

Rollback restores a complete deployment and advances the cache generation. No
account migration, credential change, history clearing or release replacement.
