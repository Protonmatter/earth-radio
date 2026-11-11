# Verified city and IANA-time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a small source-backed city/time model for Today and place-first UI without changing current playback, discovery or account behavior.

**Architecture:** Generate eleven explicit Natural Earth/IANA records from pinned public-domain inputs. A pure resolver requires coordinate/name/country agreement and exposes honest confidence; a pure formatter uses explicit IANA zones and instants. Qualification reads supplied snapshot files, with no runtime I/O or UI integration in this PR.

**Tech Stack:** Existing Node 24.18.0/npm 11.16.0, ESM, node:test, Intl and existing stationLocation/search normalization. No new dependency.

**Spec:** [design](../specs/2026-11-11-place-time-design.md)

## Global Constraints

- No dependency, paid resource, runtime network request, permission, account/schema/provider/vault change, analytics or notification subscription.
- Preserve raw fields, original UUID aliases/account identities, current playback/discovery and immutable v0.32.2 tags/assets.
- Natural Earth coordinates use [longitude, latitude]; generated points use [latitude, longitude].
- Country fallback cannot establish a city; never derive time zones from longitude or device settings.
- Keep the new modules off the active renderer path until Today consumes them.

## Review Focus

- A country's centroid or a blank/boolean numeric coercion must not qualify a city.
- Same-name places or conflicting explicit city evidence must not silently pick the first candidate.
- A valid-looking but wrong-country IANA mapping must fail generation.
- Invalid or offset-free instants must not format differently across devices.
- Program variants must not inflate the five-program qualification count.

## Task 1: Deterministic curated public data

**Files:** Create `docs/provenance/place-selection.json`, `scripts/build-place-data.mjs`, `site/assets/curated-places.js`, `docs/provenance/place-data.json`, `tests/place-data.test.mjs`. Modify the package test list and generated root manifests.

**Interfaces:** `curatePlaces(geojson, zoneTable, selection)` returns ordered validated city records. Generator consumes hash-pinned Natural Earth v5.1.2 and IANA zone1970.tab; committed output exports frozen `CURATED_PLACES`. Explicit `--download` alone may retrieve fixed pinned input URLs; `--check` validates without writing. Normal application builds make no request.

- [x] Write tests for deterministic records, coordinate order, correct country/zone, duplicate IDs, absent source ID, invalid geometry and bounded data before adding implementation.
- [x] Run `node --test tests/place-data.test.mjs`; expected RED for the missing builder/module.
- [x] Implement selection, pure curator, small generated data and input/output provenance. Pin actual official IANA bytes and license; reuse the existing Natural Earth source pin. Fail explicitly on absent/changed input.
- [x] Run the focused tests and generate/check from pinned local inputs; expected GREEN, eleven records, supported explicit IANA zones and stable bytes. Include a wrong-country-zone rejection test.
- [x] Add the maintained test command, regenerate root manifests, run `npm run verify`; expected all tests/staging/manifests green. Commit only this task's allowlisted files plus plan/spec and generated root manifests.

## Task 2: Pure conservative place and local-time model

**Files:** Create `site/assets/place-core.js`, `tests/place-core.test.mjs`. Modify the test list and root manifests. No current renderer/producer/worker entry-point change.

**Interfaces:** `stationPlace(station, places = CURATED_PLACES)` returns qualified city, supplied-coordinate, known-country or absent data as specified. `formatPlaceTime(place, instant, locale = 'en')` returns a local time string or null, with no implicit current time or device zone. Imports use existing coherent module URLs.

- [ ] Write tests for valid Seoul, wrong/missing country, country-only point, absent/blank/boolean/out-of-range coordinates, 0,0, exact point without city evidence, token boundaries, conflicting city evidence, London/Melbourne country mismatch, and ambiguous Springfield/San Jose fixtures. Assert no input mutation.
- [ ] Write time tests for Seoul, London/New York winter/summer, Kathmandu fractional offset and invalid/missing zone, instant, locale or offset-free text. No host-local time fallback.
- [ ] Run `node --test tests/place-core.test.mjs`; expected RED for missing model.
- [ ] Implement the smallest pure model using existing stationLocation/fold and explicit IANA formatting, with documented 25 km candidate gate and supplied-coordinate confidence semantics.
- [ ] Run focused tests and `npm run verify` after regenerating manifests; expected GREEN. Commit the task's allowlisted source/test/test-list/manifests.

## Task 3: Coverage qualification and maintenance documentation

**Files:** Create `scripts/qualify-place-data.mjs`, `tests/place-qualification.test.mjs`, `docs/PLACE_MODEL.md`. Update daily-return delivery notes, test list, provenance/manifest as appropriate.

**Interfaces:** File-only CLI takes an explicit public snapshot JSON path, bounded to 16 MiB/10,000 records/groups. It groups variants, resolves each program conservatively and reports confidence/city program counts plus supplied generation/source metadata. It makes no request and mutates no input/account data.

- [ ] Write tests for variant deduplication, malformed/oversized/ambiguous input, reproducible counts and no hidden network call; run focused test to observe RED.
- [ ] Implement bounded CLI and qualify the retained/publicly integrity-checked snapshot. Report actual counts; revise scope honestly rather than fabricating coverage.
- [ ] Document purpose, provenance/public-domain terms, explicit download/build/check commands, resolver API/confidence limits, coverage results, failure paths and rollback. Distinguish this prerequisite from unshipped Today/broader geocoding.
- [ ] Regenerate manifests; run focused tests and `npm run verify`, inspect exact diff and committed-object hashes. Expected GREEN with no active UI/loader/account behavior change.
- [ ] Obtain fresh read-only whole-branch review, resolve concrete findings with RED/GREEN coverage, push/create PR, attach it, and wait exact-head CI/deployed artifacts before authorized merge. Keep source and served acceptance separate. Then update Spaces and proceed to the separate Today plan.
