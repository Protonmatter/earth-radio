# Place-first presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make station rows, player facts and tooltips lead with place while retaining every existing selection and metadata workflow.

**Architecture:** A pure copy helper consumes the existing conservative city/time model. A small DOM helper updates only registered visible facts; narrow runtime hooks retain the original audio/catalog owners. Details hosts the existing variant control and technical facts, while Settings hosts the original diagnostic nodes.

**Tech Stack:** Existing ESM, Intl, Leaflet, npm/node:test, Playwright and Electron. No new dependency or service.

**Spec:** [Place-first design](../specs/2026-11-11-place-first-design.md)

## Global Constraints

- Preserve original UUIDs, aliases, collections, account/sync identity and playback ownership.
- Known cities require the existing corroborated model; unknown city means Country alone.
- Pure copy uses explicit locale/instant; UI clock updates are quiet and bounded to visible nodes.
- Raw ICY input remains separate from place facts; higher-trust metadata and history gates remain authoritative.
- Preserve variant choice, no-autoplay behavior, 7.5-second sibling budget and every existing numeric geometry limit.
- Six locale catalogs, current brand and at least 44px primary targets.
- Coherent 0.34.0/v76 when active consumers change; no large-map precache, new resource or release replacement.

## Review Focus

- A country fallback, conflicting city or malformed field cannot manufacture city/time precision.
- Place/time copy cannot become a song, provider lookup or listening record, including after minute/locale changes.
- Variant selection and Resume preserve the original identity through dialog refresh and return focus.
- Moving diagnostics cannot hide actionable load/playback failures or break palette country scope.
- Offline/updated shells and native renderers retain coherent modules, one player and original account behavior.

## Task 1: Pure place copy and conservative fallback

**Files:** Create `site/assets/place-copy.js`, `tests/place-copy.test.mjs`, `docs/PLACE_PRESENTATION.md`. Update the six locale catalogs, `package.json`, current build-state/delivery records and manifests. The helper remains unreferenced by active UI in this task.

**Interfaces:** `stationFacts(station, {locale = 'en', now} = {})` returns `{place, genre, time, text, cityId}` using existing place/country/genre helpers. It performs no I/O, implicit clock or mutation.

- [x] Add failing tests for corroborated city, country-only/conflict/centroid fallback, short localized country, meaningful genre, explicit DST/time, malformed fields and immutability; observe missing-module RED.
- [ ] Implement the pure helper and all new static keys in six catalogs; prove focused GREEN without an implicit Date.now.
- [ ] Update contracts and current delivered 0.33.1 facts, run `npm run verify`, refresh manifests and verify committed Git-object hashes; commit this inactive core.

## Task 2: Facts surfaces, Details choice and metadata signal

**Files:** Create `site/assets/place-ui.js`, `tests/e2e/place-presentation.spec.mjs` and `place-playback.spec.mjs`. Modify `discovery-ui.js`/`discovery.css`, `metadata-enrichment.js`, `responsive-ui.js`, HTML, six catalogs, the recovered runtime/reference and version/worker/provenance files. Update existing tests only to use the relocated visible controls.

**Interfaces:** `createStationFacts(station)` registers a row node; `updatePlayerFacts(station, {rawTitle} = {})` marks facts and retains bounded raw input for the same identity. The existing metadata extractor reads the explicit input without treating facts as a song. Original `variantControl` stays the sole selection owner inside Details.

- [ ] Write browser RED cases for place-first rows/player/tooltip, no false metadata/provider/history work, actual raw/HLS/platform title preservation and minute/locale updates without playback change.
- [ ] Implement visible-node clock rendering and narrow runtime hooks; keep compact palette country metadata compatible with country selection. Preserve higher-trust metadata fencing.
- [ ] Move original variant controls to Details; show technical facts there. Reproduce and cover no-autoplay choice/Resume, alias favorites, sibling budget, refresh/close focus and web playability guidance.
- [ ] Move original diagnostic nodes to Settings and add neutral map summary; preserve load/playback recovery. Probe the auto-open account-error focus observation and correct only a demonstrated defect.
- [ ] Add all six-catalog strings and scoped existing stylesheet rules. Check Paper/Night, RTL, 320–1440px, enlarged text, safe areas, tooltips and at least 44px controls with unchanged limits.
- [ ] Advance coherent 0.34.0/v76, fingerprint and refresh source/model provenance. Run full verify, all browser/rendered/native gates before committing the UI integration.

## Task 3: Reviewed delivery and final phase3 desktop release

**Files:** Update qualification, operations, installation/build-state/provenance records and maintain the decision ledger. Use existing release tooling and separate immutable artifacts.

- [ ] Run the whole-regression acceptance and one fresh read-only whole-branch review; reproduce concrete Important/Critical findings before one covering fix pass, then require green gates.
- [ ] Commit/push/create/attach the PR; require ten exact-head checks and actual preview bytes/headers/routes/UI, then exact-head merge, final-main/production acceptance and guarded Spaces readback.
- [ ] Build Windows ARM64/x64 installer/portable and native Mac ARM64/x64 DMGs from final phase3 source; qualify source/package/signatures/startup/restart, create checksums/provenance, verify every draft/public download and preserve prior assets.
- [ ] Update installation/static release presentation only from verified complete published assets, requalify final main/served parity and Spaces, then continue the approved Passport/Media Session/share/install/data/performance/atlas/SEO sequence.
