# Today home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Atlas/Today a useful one-tap launch with honest city/time data and bounded native sampling.

**Architecture:** A pure frozen-UTC calendar and common program components derive matched candidates from the existing catalog. A maintained Today module receives snapshots/actions through a narrow runtime adapter; responsive presentation owns destinations. Native enrichment opts into the same data from the already downloaded root.

**Tech Stack:** Existing ESM, Intl, Leaflet, npm/node:test, Playwright/Electron. No new dependency or service.

**Spec:** [Today design](../specs/2026-11-11-today-home-design.md)

## Global Constraints

- No second audio player, catalog, account store or map.
- UTC date alone chooses from a separately frozen v1 calendar of eleven IDs.
- Up to five matching program representatives per calendar city, at most55 additions; no extra directory request.
- Existing station-intent budget/counters/UUID aliases/account data stay authoritative.
- Six locale catalogs, existing cream/pine/copper/serif identity, touch targets at least44px.
- No new dependency, paid resource, permission, analytics, notification or geocoder.
- Candidate0.33.0/coherent fresh worker; prior0.32.2 tags/assets immutable.

## Review Focus

- Clock rollover, locale/filter changes or refresh cannot start/change a playing program.
- A native limit or mixed/partial variant set cannot inflate the five-program cohort.
- Returning/deep-linked launches must preserve existing identities, data and explicit playback.
- Hidden legacy controls must not become duplicate focus targets or break dialog return focus.
- Offline/empty/unsupported-domain cases must remain usable without a second loader/store.

## Task 1: Pure calendar, program choices and native opt-in

**Files:** Create `site/assets/program-components.js`, `site/assets/today-core.js`, relevant node tests. Modify `scripts/qualify-place-data.mjs` to reuse common components and refresh coverage/proof tests. Modify `server/desktop-proxy.mjs`/native tests for the opt-in. No UI wiring yet.

**Interfaces:** `programComponents(stations)` returns existing groups, connected row components and canonical identity count with no I/O/mutation. `todayPlaceForUTCDate(dayKey, places)` uses explicit YYYY-MM-DD UTC and frozen IDs. `cityProgramChoices(stations, cityId, options)` returns one ranked matched station per component. `appendCitySeeds(prefix, root)` returns a prefix-preserving array with at most55 matched additions. Existing native federated input supports optional `placeSeeds=1`, default false.

- [x] Add failing tests for frozen calendar/date validity, all-day/next-day/TZ/order independence, aliases/shared streams, matching-variant choice, country/city conflict, stable rank and input immutability. Observe missing-module RED.
- [x] Extract common components without changing accepted qualifier results; preserve conflicting-duplicate failure. Implement pure date/candidate/seed helpers, then run focused tests GREEN. Check frozen metrics unchanged and update hash-bound receipt.
- [x] Add native request tests for default unchanged, invalid flag400, prefix/IDs/budget, five supported programs, missing-city degradation and no extra read. Observe RED, wire explicit opt-in and run GREEN.
- [x] Update test list/manifests, run npm run verify and committed-object checks; commit the bounded task. Record decisions/tests in this plan's ledger.

## Task 2: Today surface, three primary destinations and runtime adapter

**Files:** Create `site/assets/today-ui.js` and `today-ui.css`. Modify `site/index.html`, `responsive-ui.js`, six locale catalogs, selected runtime narrow dashboard/footer/native-request hooks, config/package/reference version and worker/provenance/fingerprints. Preserve existing control IDs/owners.

**Interfaces:** `installToday(adapter)` receives existing `play`, pause/toggle, refresh, domain/map and snapshot authority. `observe(snapshot)` consumes stations/currentStation/lastPlayed and active player state. `defaultStation()` supplies idle Continue/Today. Runtime continues to own all audio, routes and persistence. UI destination today joins legacy states; primary nav groups Atlas/Library/Search, existing saved/current-account panes remain the data owners.

- [x] Write failing browser cases for default/returning390x844, named one-tap play/pause/retry, no autoplay, date rollover without audio change, explicit deep link, Library controls/focus and empty/offline data. Add pure UI/destination tests where appropriate; observe RED.
- [x] Build semantic Continue/Today's place/On air sections with stable buttons and bounded text. Add primary nav/Library presentation, Settings utilities and generic visible skip target, keeping old runtime controls as single authoritative elements. No duplicate visible overflow actions.
- [x] Wire the narrow dashboard snapshot/action adapter and idle footer/default native request flag. Fingerprint runtime, record exact rationale, advance candidate0.33.0 and fresh worker/module URLs, include only small new active modules/CSS in precache.
- [x] Add every visible string to all six catalogs. Validate first-viewport geometry,44px controls, palettes/RTL/text zoom, reduced motion and actual map; inspect screenshots and correct concrete collisions.
- [x] Run focused tests, npm run verify and relevant rendered/native gates. Commit only qualified feature files/manifests.

## Task 3: Whole-regression and authorized delivery

**Files:** Update maintained list-focused e2e/rendered helpers/tests to explicitly navigate Search/legacy contexts while adding default Today tests. Update docs/BUILD_STATE.md, installation/candidate notes and runbook/provenance as needed.

- [ ] Preserve all search/filter/loader/variant/identity/auth/sync assertions; fix actual regressions with observed RED→GREEN, not lower thresholds or fixture-only bypasses. Record the test invocation environment.
- [ ] Run full verify, all browser/rendered/native checks, diff/secrets/source/provenance review and a fresh read-only whole-branch review. Fix concrete findings with covering tests and refresh bound receipts.
- [ ] Commit/push/create/attach the PR, wait exact-head required CI and actual preview bytes/headers/routes plus visible mobile/desktop geometry. Merge exact head only after acceptance, then require final-main/production readback and update Spaces preserving history/vault.
- [ ] Continue to separate ER-05 place-first presentation. Qualify/rebuild/publish the next immutable Windows/Mac desktop release from final phase3 source with full receipts/download checks; never replace v0.32.2 assets.
