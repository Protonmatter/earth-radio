# Station discovery and the listening atlas

The November 2026 candidate adds maintained discovery modules to the recovered application. The running web and Electron clients use the same modules. The older `src-recovered/` tree remains a maintenance reference, not a reproducible application build.

## Listener controls

- **Find a station:** inline search across station name, country, country code, genre tags, and language. All terms must match. Accents are normalized, non-Latin scripts are retained, and words of 5–32 characters allow one edit for spelling mistakes. Search is debounced by 140 ms and waits for IME composition to finish. Search never starts playback.
- **Refine selection:** exact genre and language facets, minimum declared bitrate, HTTPS-only selection, and a switch to hide stations that recently failed on this device. These are additional constraints on the existing country, favorites, recent, and genre-collection filters. The disclosure starts closed on phones.
- **Selection method:** Best match, Reliability, Explore the world, Similar to playing, Highest bitrate, or Name A–Z. Similar is unavailable until there is a selected station. The default keeps Recent in chronological order and preserves the Similar view's ranking.
- **Find my next station:** selects an alternative from the current visible pool. It excludes the current stream, duplicate stream endpoints, and stations within the failure cooldown. On HTTPS pages it only selects HTTPS streams. With no suitable alternative, it explains how to broaden discovery.
- **Details:** opens an accessible station dialog with country/language/format and the factors that influenced ranking. Escape closes the dialog; the dialog's Play action selects that exact station. Merely opening details does not start playback.
- **Atlas controls:** Search this area captures the current geographic rectangle and, on first use in the tab, loads a bounded world directory of mapped stations. It switches to All and clears conflicting country selections while retaining genre, language, query and quality constraints. Panning afterwards does not silently change the rectangle. Clear area is available on the map, including phones. Fit stations fits the current pool's valid locations. On air focuses the selected station. Missing locations are counted separately.

Reset clears the new discovery controls and map rectangle. The existing empty-state Clear filters action clears both the new controls and the runtime's traditional filters.

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
