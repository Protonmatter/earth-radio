# Earth Radio discovery and vector atlas implementation plan

**Goal:** Upgrade the running web/Electron application with understandable station selection and an independently rendered vector basemap.

**Authority:** The user asked for production readiness, better features/algorithms/radio selection and a replacement map, then explicitly delegated design choices and implementation. No commit, push, deployment, credential, hosted configuration, or added package is authorized.

**Architecture:** Keep the recovered runtime and its public interfaces. Extract new functionality into maintained native ES modules. Integrate through narrow, documented runtime calls, then regenerate the runtime content hash and release metadata. Keep all discovery computation on the device. Retain Leaflet interaction/clustering; replace CARTO raster requests with bundled, public-domain Natural Earth land vectors.

**Stack:** Existing Node 24.18.0, npm 11.16.0, native browser modules, bundled Leaflet, node:test, Playwright. No new npm dependencies or backend endpoints.

**Design:** Existing Night/Paper brand; atlas is the dominant visual; asymmetric station-list/map workspace; teal ocean/land with coral station accents; system serif display headings and existing platform body fonts; primary action remains playing a station. List keyboard navigation and browser-native controls remain accessible. No location permission or account requirement.

## Constraints and failure cases

- No claims of learned/calibrated quality. Ranking weights are explicit engineering heuristics; observed failures are distinct from directory health assertions.
- Stable UUID tie-breaks, finite/bounded numeric inputs, Unicode text, conjunctive search, station URL de-duplication for recommendations, and no mutation of source records.
- Unknown coordinates never become (0,0); bounding boxes crossing the antimeridian work.
- Existing favorites, recent ordering, playback identity, routing, authentication, and metadata boundaries survive the upgrade.
- Search must not autoplay, map hover must not autoplay, and clear must restore the existing filtered station pool.
- User-controlled station strings use textContent; marker popups retain existing escaping.
- Shell assets are cached together under a new worker generation; runtime content hash and every reference must agree.

## Task 1: Pure discovery engine

Files: site/assets/discovery-core.js, tests/discovery-core.test.mjs.

- [x] Write and run failing tests for relevance, Unicode, token conjunction, safe streams, stable ordering, deduplication, observed failures, bounds, distance, and diversity.
- [x] Implement rankStations(stations, options) -> {station, score, reasons}[], rankSimilar(target, stations, limit), pickStation(stations, options, random), coordinates(station), inBounds(station, bounds), and sanitizePreferences(value).
- [x] Use field-weighted BM25 relevance, normalized genre similarity, a smoothed playback-success estimate, failure cooldown, and greedy maximal marginal relevance on a bounded candidate pool for exploration.
- [x] Validate with node --test tests/discovery-core.test.mjs.

## Task 2: Maintained discovery UI and vector atlas

Files: site/assets/discovery-ui.js, discovery.css, vector-atlas.js, world-land.js; site/index.html; tests/e2e/discovery.spec.mjs.

- [x] Encode inline search/facets/reset, map-area filtering, ranking explanations, keyboard access, palette and zero-tile-request scenarios in browser tests; observe failure before implementation.
- [x] Implement installDiscovery(adapter) with pure transformation and runtime callbacks; re-use the active filtered pool and preserve recent ordering.
- [x] Bundle simplified public-domain Natural Earth land geometry with source/checksum provenance. Draw in a noninteractive basemap pane; station markers stay above it. Provide fit/focus/area controls and accessible visible status.
- [x] Keep discovery state tab-local so account transitions cannot leak preferences/history. Bound per-tab outcome memory.

## Task 3: Runtime integration and release qualification

Files: recovered hashed runtime, src-recovered/main.ts and ui/map.ts, site/sw.js and _headers, package.json, relevant existing tests, docs/ARCHITECTURE.md, docs/OPERATIONS.md, docs/BUILD_STATE.md, README.md, release manifests.

- [x] Hook station transformation, advanced similarity/surprise, health observations, fresh marker payloads, map and playback callbacks. Keep integration points documented beside maintained modules.
- [x] Update hashed filename and all references; add new tests to npm test and new shell assets to the worker.
- [x] Run npm run check, node unit tests, npm run test:e2e, npm run test:rendered, npm run verify and git diff --check.
- [x] Review the final diff independently where supported; fix concrete regressions and repeat affected checks only.
- [x] Record exact verification and exclusions. Leave all work uncommitted and undeployed.

## Progress

- Baseline: npm run verify passed (322 passed, 1 Windows symlink-policy test skipped; desktop and metadata smokes passed).
- Baseline Git HEAD: 81c5e59; working tree clean before this task.
- Tasks 1–2 implemented and verified: 12 pure discovery cases and six browser workflow/regression cases. Final full browser suite: 43 passed.
- Independent review and closure review complete. Two P2 discovery refresh defects and the P2 numeric-coordinate validator false positive were corrected with regressions. No remaining actionable P0–P2 issue identified within the review scope.
- Rendered qualification: all 41 scenarios complete, no errors, layout/action/locale assertions passed; temporary artifacts now remain under .build/evidence. Windows trusted input uses the owned Chromium renderer's focus emulation rather than native foreground eligibility.
- Offline smoke passed: five new assets cached, uncached request blocked, 127 land features and the cached fixture directory restored after reload.
- Node suite: 341 passed, 1 Windows symlink-policy test skipped; metadata/desktop proxy smokes passed. Additional runtime-fingerprint preflight/idempotence tests pass. Local GoTrue integration was not run.
- Full npm run verify passed, including staging and 193 deterministic release hashes. All implementation tasks are complete; no commit, push or deployment performed.
- Ruling: serialize e2e and rendered browser suites on this host to avoid contention. Correct readiness barriers rather than masking failures with retries or timing increases.
