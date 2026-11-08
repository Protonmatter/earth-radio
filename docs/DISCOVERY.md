# Station discovery and the listening atlas

The November 2026 candidate adds maintained discovery modules to the recovered application. The running web and Electron clients use the same modules. The older `src-recovered/` tree remains a maintenance reference, not a reproducible application build.

## Listener controls

- **Find a station:** inline search across station name, country, country code, genre tags, and language. All terms must match. Accents are normalized, non-Latin scripts are retained, and words of 5–32 characters allow one edit for spelling mistakes. Search is debounced by 140 ms and waits for IME composition to finish. Search never starts playback.
- **Filters:** exact genre and language facets, minimum declared bitrate, HTTPS-only selection, and a switch to hide stations that recently failed on this device. These are additional constraints on the existing country, favorites, recent, and genre-collection filters. The disclosure starts closed on phones.
- **Selection method:** Best match, Reliability, Explore the world, Similar to playing, Highest bitrate, or Name A–Z. Similar is unavailable until there is a selected station. The default keeps Recent in chronological order and preserves the Similar view's ranking.
- **Find my next station:** selects an alternative from the current visible pool. It excludes the current stream, duplicate stream endpoints, and stations within the failure cooldown. On HTTPS pages it only selects HTTPS streams. With no suitable alternative, it explains how to broaden discovery.
- **Details:** opens an accessible station dialog with country/language/format and the factors that influenced ranking. Escape closes the dialog; the dialog's Play action selects that exact station. Merely opening details does not start playback.
- **Atlas controls:** Search this area captures the current geographic rectangle and, on first use in the tab, loads a bounded world directory of mapped stations. It switches to All and clears conflicting country selections while retaining genre, language, query and quality constraints. Panning afterwards does not silently change the rectangle. Clear area is available on the map, including phones. Fit stations fits the current pool's valid locations. On air focuses the selected station. Missing locations are counted separately.

Reset clears the new discovery controls and map rectangle. The existing empty-state Clear filters action clears both the new controls and the runtime's traditional filters.

## Approved listening-room presentation (November 7)

`site/assets/listening-room.css` is the final presentation override, loaded after
the previous stylesheets. It implements the approved ivory, forest-green and
copper concept with a 208px desktop rail, platform serif headings, station artwork,
compact rows, quieter map controls and the existing mobile safe-area shell. Paper
is the default for a new profile; explicit saved Night/Paper choices are preserved.
English navigation uses Map, Browse, Favorites and Account. Other locales retain
their maintained translations. The displayed station data comes from the directory.
Search precedes genre shortcuts in the reading/focus order. The existing quick-pick
section moves intact into More actions, preserving its delegated runtime handlers.
The map's station card is bounded and scrollable so it cannot cover the atlas;
the full Now Playing view remains available from the bottom player.

The recovered virtualizer's presentation constants now use an **88px row stride,
12px gap and one column**. Its existing renderer, click handlers, filtering,
scroll-window calculation, network requests and account logic are preserved.
The source reference carries the same constants. The runtime is fingerprinted
again using `node scripts/fingerprint-runtime.mjs`, with provenance retained in
`docs/provenance/hardening-overlays.json`. The responsive adapter measures the
actual stride and sizes the visible cards to 76px. CSS alone cannot safely change
the virtualizer's stride. Details remain available on every station row.

The bundled Natural Earth land atlas remains tile-free. The concept's illustrative
city labels and country boundaries are not asserted as data that this land-only
dataset contains. No font service, map provider, tracking or dependency was added.

Validation: `npm run verify`, `npm run test:e2e`, and `npm run test:rendered`.
Rendered tests cover virtual-row geometry, touch targets, narrow/large windows,
zoom, RTL, locale and modal navigation. Fixture playback verifies interactions;
it does not qualify live station availability or fidelity. See the final task
report for observed results. This is a local candidate, not a published release.

November 7 local results: `npm run verify` passed (415 tests, three platform skips,
metadata/desktop smokes, 48 staged site files and 241 source hashes); all 57
Chromium end-to-end tests and all 42 Electron rendered scenarios passed. Evidence
is under the ignored `.build/ui-*.log` and `.build/evidence/` paths. The rendered
harness clears its test database between scenarios to prevent stale locale and
favorites from contaminating screenshots. Browser playback helpers wait for the
application's settled playing state before issuing transport commands. The local
preview also loaded the cached directory and displayed Classic Vinyl HD's details.
Live audio and authentication were not requalified for this visual change.

Rollback: revert this candidate's tracked changes as a unit (including the hashed
runtime, references and provenance), rebuild with `npm run build:web`, and run
`npm run verify`. If a candidate was ever deployed, publish the prior verified
source with a newer shell-cache name so installed clients receive the rollback.
Never republish a changed artifact under an existing desktop release tag.

## Tooltip layout follow-up

The maintained listening-room stylesheet gives the map tooltip a 280px border-box
width capped at the viewport minus 32px. Leaflet's positioning pane has no intrinsic
width; a maximum alone allowed the former grid tooltip to shrink to 69px and break
the country, pending message and listening hint into a narrow column. The follow-up
uses the current Paper/Night surface colors, readable metadata contrast, natural
long-name wrapping and a separated, sentence-case listening hint. Tooltip lookup,
hover and station-selection handlers are unchanged. The shell advances to v61 so
the changed stylesheet is refreshed when this candidate is deployed.

The rendered tooltip regression covers 1440px, 390px and 320px layouts, both
palettes, long station names, pending/resolved metadata and hover without autoplay.
This follow-up is a local candidate until separately committed and published.

## On-demand world map coverage

The initial catalog is a bounded popular/featured-country sample, so filtering it
alone cannot populate arbitrary map regions. `map-directory.js` requests the
documented Radio Browser `has_geo_info=true` / `hidebroken=true` search on explicit
area search. The API does not document a viewport-bounds filter; the client loads
up to **10,000 mapped records** globally and applies the captured rectangle locally.
This is a sample, not a claim of exhaustive coverage or verified station uptime.
The loader tries at most two fixed HTTPS endpoints (the current server and the
service DNS alias, not independent backends), with one **20-second deadline**,
**16 MiB per-response byte cap**, record validation and UUID deduplication. It
fetches directory metadata only, never station audio. A live diagnostic returned
10,000 records across 184 country codes before the fix was deployed.

The directory is loaded only on demand, single-flight, and reused for the current
tab. Clear/reset cancels a pending request; generations prevent a late response
from changing a cleared/newer selection. Failed loads remain retryable and show
an explicit map notice. No-result notices mention the area and active filters.
The radio-only guard prevents this directory entering the separate SDR domain.

The runtime's existing station normalizer and quality model process each record;
malformed optional metadata is skipped per record. Merging retains richer existing
federated records and fills absent coordinates without replacing their source
quality. The tab's expanded catalog also survives a manual directory refresh via
the maintained augmentation hook. These extra directory records are not synced
to accounts or persisted as a new user-data collection. Favorites/recents retain
their established persistence behavior. No location permission is requested.

The module itself is cached with the application shell. Loading new directory
metadata still requires networking; an offline first area search reports the
failure and keeps the existing catalog usable.

## Ranking model and limits

`site/assets/discovery-core.js` is pure: no DOM, storage, network, telemetry, or learned profile. `rankStations(stations, options)` returns `{ station, score, reasons }` entries without mutating station objects. Sort ties use normalized names and UUIDs with code-point comparison, avoiding locale-dependent ordering.

Search uses field-weighted BM25 with k1=1.2 and b=0.75. Name, country, genre, and language field weights are 6, 3, 4, and 2; fuzzy matches receive 40% of the field weight. IDF is computed over the eligible corpus before the all-term match constraint. Exact/phrase name matches add 35/18 points. Inputs are limited to 160 characters and eight unique query terms; fuzzy word comparisons are length- and count-bounded.

The base ranking contributes 0.55 × the existing directory quality score, 18 × a smoothed success estimate, 8 for an HTTPS endpoint, and 5 for a passed last directory check. Reliability mode adds 20 × the estimate and 0.2 × directory quality. The success estimate uses a Beta(2,1) prior over successful/failed playback callbacks observed in this tab, capped at 1,000 of each per station and 500 observed stations. These are engineering weights, not fitted or empirically calibrated probabilities.

Existing device playback failures have a **15-minute cooldown**. During that period they subtract 65 points and are excluded from random/similar recommendations; Hide recent failures also excludes them from ordinary discovery. Old failure records stop suppressing selection. Directory health and observed playback outcomes remain distinct facts in the explanations. Upstream failures, browser format support, and station metadata can change independently of the score.

Similarity adds up to 65 points for normalized genre Jaccard overlap and excludes the selected station and duplicate endpoint URLs. Exploration applies maximal marginal relevance to the first 120 candidates: genre redundancy costs up to 0.25 and matching country up to 0.18 in score/100 units. Incremental redundancy updates bound this step to quadratic work over those 120 candidates. The rest retain their stable base order. Random discovery samples up to 80 diversified, endpoint-distinct candidates, weighted by score divided by the square root of the country's candidate count, reducing catalog-size bias. The random source is injectable in tests.

URLs must parse as credential-free HTTP(S) endpoints. HTTPS filtering checks the parsed protocol rather than trusting a directory flag. Unknown/empty/boolean/non-finite coordinates and the directory's (0,0) sentinel are not mapped. Genuine points on either zero axis work. Rectangle filtering handles the antimeridian and full/repeated world extents.

Discovery controls and success counters are **tab-local** and are never synced or exported. The existing runtime continues to own persisted favorites, recents, preferences, and failure records. New copy currently uses English; the application's existing locale controls remain available, with existing translated chrome preserved.

## Integration contract

`installDiscovery(adapter)` consumes `context() -> {badStations}`, `map()`, `current()`, `visible()`, `refresh()`, and `play(station)`, plus `allowDirectory()` (radio domain only), `prepareArea()` (clear geographic/view conflicts), and `normalize(raw)` (existing runtime normalizer). It returns `augment(stations)`, `transform(stations, {all, view})`, `explainButton(station)`, `options()`, `observe(station, ok)`, and `clear()`.

The recovered runtime imports the maintained modules and calls only these narrow integration points:

1. Construct the adapter before asynchronous startup; callbacks read the runtime's existing state.
2. Augment the base catalog with validated mapped stations, then apply existing filters and discovery before grid/map/search rendering.
3. Use the shared similarity and random-selection functions in existing discovery actions.
4. Observe the existing player callbacks; successful selection events keep their original truthfulness/identity gates.
5. Draw the new basemap using the shipped Leaflet engine. Retain clustering, hover disclosure, marker selection, and escaped popup content.
6. Update an existing marker's location and current station payload on refresh, so hover/click cannot select an obsolete object with a reused UUID.

After editing the recovered runtime, run `node scripts/fingerprint-runtime.mjs`. It derives the SHA-256 filename, updates current shell/header/test references, and synchronizes the current runtime/shell identities in the hardening overlay while preserving immutable intake evidence. The engineer must record the change rationale in that overlay. Then run the release-manifest command after all other changes settle. A worker generation change is required when maintained modules change; the discovery/atlas modules, including the world-directory loader, are precached together.

## Validation

```powershell
node --test tests/discovery-core.test.mjs
npm run test:e2e -- --workers=3
npm run test:rendered
npm run release:manifest
npm run verify
git diff --check
```

Browser tests intercept external requests and use fixture audio. They establish application behavior, not real station uptime, stream fidelity, physical-device compatibility, or production deployment configuration. A local 10,000-record synthetic timing probe took approximately 80–115 ms for these ranking/selection operations on the development host; this is not a throughput guarantee or recommendation-quality evaluation.

## Geographic atlas interaction follow-up

Version 0.28.0 bundles country/city labels and geographic detail; see [map data](MAP_DATA.md).
Station tooltip cards stay inside the visible map/viewport, including while their
metadata changes. The desktop Hide map control is absolutely positioned so it does
not add a hidden 30px scroll row that moves a station during pointer selection.
Explicit Fit stations and area-search actions stop residual camera corrections,
measure the map and restore the same drag limits in a finally path. This prevents
a hidden-to-visible resize correction from overriding a newer fitted view.
