# Today selection and launch

The Today work is staged in bounded commits. This first commit supplies pure
selection and the opt-in native catalog enrichment; the active browser launch,
navigation and playback presentation remain unchanged until the UI integration.
The delivery specification is [Today home](superpowers/specs/2026-11-11-today-home-design.md).

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
existing direct-mirror fallback keeps its old bounds/fanout and may offer fewer
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
