# Today selection and launch

Candidate 0.33.0 integrates Today through a narrow adapter to the existing runtime.
It is local feature work until exact-head review, CI and deployed acceptance pass;
the previously published 0.32.2 desktop release is unchanged. The feature is staged
in bounded core, UI and regression/delivery commits.
The delivery specification is [Today home](superpowers/specs/2026-11-11-today-home-design.md).

## Presentation and ownership

An unqualified fresh root launch opens Today. Reload/back navigation retains the
current destination so a cleared URL fragment cannot discard a search workflow.
Explicit legacy destination/filter fragments, station links and saved-view links
keep their original meaning. Stored language,
palette, split, favorites, history and account data are retained. Atlas, Library
and Search form the primary navigation; Library groups the existing station,
song and account owners. Settings contains the existing transfer/preference
actions. The original control IDs and delegated handlers remain authoritative.

Today shows a separate Continue action when a current/last station exists, one
named city recommendation and up to three other program components. Every play
or retry calls the same station-intent owner with its existing 7.5-second sibling
budget; World Scan remains a separately labeled explicit action. No render or
clock tick can play, retarget audio, report a directory click or write history.
The idle player offers the same named Continue/Today selection and disables its
primary action when none is available. A blank Now Playing sheet cannot be opened.

The date/clock updates at least once per minute and on foregrounding. Hero choice
is fixed for a UTC date/catalog revision; playback failure alone cannot silently
reroll it. On air excludes the entire hero program component, and stable button
nodes preserve keyboard focus when the recommendation changes at midnight.
The compact mobile map opens the same full atlas. Six locale catalogs, Paper/Night,
44px new controls, keyboard skip navigation and responsive geometry have dedicated
browser regressions; these are fixture-based checks, not physical-device acceptance.

Library tabs remain out of Search. Short wide windows hide the duplicate list
heading and genre shortcuts so a complete station row fits; Refine retains all
genre filtering. Settings/player controls wait for their existing handlers or
playable selection. Settings owns initial/return focus, and palette selection
aligns its hidden existing theme field before Save.

The recovered router suppresses feedback only for a real hash assignment.
`history.replaceState` emits no hashchange event and must not consume the next
user fragment. Same-document geography and quality links retain their meaning.
Owned skip links move keyboard focus without changing fragments, history or active
filters. Settings contains Tab/Shift+Tab focus and restores its visible trigger.

The 0.33.0 module URLs and v74 worker include only the small active Today/place
modules. Large map detail/terrain/roads remain outside the precache. The recovered
runtime is fingerprinted after its recorded integration edit; the old TypeScript
snapshot is still a reference and does not reproduce it through compilation.

## Selection contract

`todayPlaceForUTCDate(dayKey, places)` requires a real `YYYY-MM-DD` UTC date.
It indexes the separately frozen eleven-ID `TODAY_CALENDAR_V1` from the Unix
epoch, wrapping negative dates correctly. It never uses a device timezone, row
order, search filter, locale, health outcome or random source. A missing curated
record or invalid date/zone returns null; it does not silently pick another city.

`programComponents(stations)` shares the qualifier's station-family, shared-stream
and canonical-UUID component logic without rewriting identities or input rows.
The qualifier retains its stricter conflicting-duplicate validation before using
this helper. Conservative program counts do not count stream aliases as cities.
The shared helper admits at most 50,000 observations, covering the existing reader
maximum of 40,002 after root/country/pinned/map augmentation. Native seed inputs
retain their separate 6,500-prefix and 10,000-root limits. Optional recommendation
failure clears the recommendation and leaves Continue/Search/refresh usable; it
cannot turn the shared catalog load into a playback or search failure.

`cityProgramChoices(stations, cityId, options)` returns at most one corroborated
variant per non-conflicting program component, ordered by the existing reliable
ranker. A city-supported sibling cannot confer city evidence on an unsupported
variant. HTTPS is required by default; the native loopback renderer can explicitly
allow HTTP. Health evaluation uses an explicit `now` or epoch zero, never an
implicit current clock. A displayed recommendation must stay fixed for its date
and catalog revision, especially after failure; selection itself never plays,
persists history, mutates favorites or reports a click.

## Native catalog enrichment

The existing capability-protected native federated/top routes accept the optional
query `placeSeeds=1`. Omission preserves existing behavior. Empty, repeated or
other flag values return HTTP 400 before directory I/O. The opt-in uses a distinct
in-memory cache key with the existing ten-minute TTL and bounded cache.

The published catalog root is already downloaded before its popular prefix is
selected. `appendCitySeeds(prefix, root)` reuses that root to bring available
calendar cities to five supported programs, appending at most five per city and
55 total above the original merged/capped prefix (6,500 maximum). It preserves
prefix order and original station identities and adds no directory request. The
opt-in result adds bounded `nativeProgram: {id, cityId}` evidence to each selected
row. Its ID joins full-root components only for recommendation counting, and its
city or null restricts qualification when the sample omits a transitive bridge or
conflicting place. It cannot confer coordinates/city evidence, change UUIDs,
expand playback-recovery families or change default endpoint results. All original
prefix fields are preserved; objects are copied to avoid mutating input records.
Invalid present support fails city qualification rather than becoming evidence.
The existing direct-mirror fallback keeps its old bounds/fanout and may offer fewer
city programs during a published-directory outage; the UI must disclose the
available count rather than promise complete coverage.

On the retained integrity-checked 2026-11-11 catalog, a 3,000-row root prefix needs
16 additions to provide at least five native programs in each of eleven cities.
This is frozen-data coverage, not live playback qualification. Istanbul has three
HTTPS choices and Seoul four in that sample; web presentation cannot claim five
HTTPS choices for them. Source generation, model and host-timezone limitations
remain in [the place model](PLACE_MODEL.md).

## Verification and rollback

```powershell
node --test tests/today-core.test.mjs tests/native-directory.test.mjs tests/place-qualification.test.mjs
npm run release:manifest
npm run verify
```

The retained-input qualifier was rerun after extracting the common helper; every
coverage metric and example identity remained identical, and the receipt now
binds eleven model files. No new dependency, provider, paid resource, account
schema, permission, analytics or notification was introduced. Rollback is a normal
revert of the feature branch or omission of the optional native query; no user
data migration or clearing is needed. Published v0.32.2 assets remain immutable.
