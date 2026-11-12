# Listening Passport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans
> inline. No implementer agents; one fresh whole-feature reviewer at the end.

**Goal:** Earn country/confirmed-city Passport entries after 60 continuous seconds
of measured playback, with private local/account persistence and clear-history safety.

**Architecture:** Separate bounded Passport document and pure continuity model;
owner-and-song-policy-fenced IndexedDB, existing CAS sync and additive key admission.
Library view and country shading consume qualified data. A supported transfer bridge
extends legacy export/import without changing existing document formats.

**Tech Stack:** Existing Node24/npm, browser/Electron ESM, IndexedDB, Leaflet,
Supabase Postgres/RPC, node:test and Playwright. No new runtime dependency/service.

**Spec:** [Passport design](../specs/2026-11-12-listening-passport-design.md).

## Global constraints

- Base6c26e08602daee5976f6eab6908a647f42877861; feature branchfeat/listening-passport.
- Threshold60,000ms; maximum gap5,000ms; media jump tolerance500ms. Accumulate
  bounded integer microseconds from advancing media and monotonic wall deltas.
- 300countries/1,000cities/128,000client UTF-8 bytes;262,144server/native bytes.
- Existing six locales, Paper/Night, RTL,320px layout and44px controls.
- Old formats/accounts/UUIDs and published0.34.1 assets preserved. No original
  profile mutation, telemetry, geolocation, provider change or new paid resource.
- Generated migration20261112033456_listening_passport.sql is local and empty;
  never apply an unqualified schema. Keep CLI2.115.0 and existing isolated CI stack.
- Feature web identity0.35.0 with a fresh worker generation at final integration.
  Desktop publication follows completion of the approved phase4 feature sequence;
  current download fallback stays on the latest fully verified desktop release.

## Review Focus

- Account changes during IDB open/commit/backup/export/import never disclose or
  mutate another profile; initial signed-in sync is a write gate.
- Old-client clear, held writes, stale cloud values/baselines/backups cannot revive
  a previous history epoch. Contradictory/future policy fails closed without erasure.
- Paused/stalled/muted/seeking/discontinuous/background-gap playback never earns
  a minute through timer accumulation, retries or station-variant changes.
- Legacy and Passport-only transfer remain valid; partial import failure is
  reported accurately; foreign epochs/settings never clear local records.
- Map shading and Library UI clear immediately on policy/owner transitions and
  preserve theme/labels/focus/RTL/phone layout and unrelated station/audio behavior.

### Task 1: Pure document, envelope and continuity model

Files: create `site/assets/passport-core.js`, `tests/passport-core.test.mjs`;
register the test inpackage.json. Include spec/plan in this task's commit.

Interfaces: `PASSPORT_LIMITS`, `emptyPassport(epoch=0,clearedAt=0)`,
`normalizePassport(value)`, `recordPassportPlace(doc,place,day)`,
`mergePassports(a,b)`, `mergePassportsThreeWay(base,local,remote)`,
`addPassportVisits(current,imported)`, `passportEntries(doc)`,
`passportNamespaceKey(namespace)`, `passportSyncStateKey(namespace)`,
`encodePassportEnvelope(namespace,generation,value,savedAt)`,
`decodePassportEnvelope(raw,namespace)`, `exportPassport(value)`,
`importPassport(text)` and `ContinuousPassportSession.sample(input)/reset()`.
Sample fields: `{now,mediaTime,day,ownerNamespace,ownerVersion,historyEpoch,
settingsVersion,historyEnabled,ready,programKey,sourceKey,place,playing,muted,
volume,readyState,seeking}`. Observation retains place/day and owner/epoch fences.

- [x] Write RED cases:59,999ms earns nothing/60,000ms earns one; repeated samples
  do not duplicate a day; pause/stall/mute/seek/owner/program/source/policy changes
  restart the run;5,000ms gap accepted/5,001ms resets; invalid clocks and media
  jumps do not earn credit. Use explicit synthetic clocks and label them synthetic.
- [x] Add schema/size/future/prototype/Unicode tests, country-only vs confirmed city,
  stable ordering, same-epoch union, higher-epoch removal, three-way/CAS-compatible
  merge, positive-only import, namespace/checksum and future-envelope failures.
- [x] Run `node --test tests/passport-core.test.mjs`: observe RED, implement the
  smallest pure model, then require all cases GREEN. Update manifest; explicit commit.

### Task 2: Atomic local persistence and privacy clear

Files: create `site/assets/passport-store.js`, `site/assets/passport-policy.js`,
`tests/e2e/passport-storage.spec.mjs` and its `fixtures/passport-store-harness.mjs`;
modify `song-library-store.js` narrowly.

Interfaces: `createPassportStore(options)` / `passportStore()` expose
`read`, `mutate(transform,{ownerVersion,historyEpoch,settingsVersion})`, `readForAccount`,
`writeForAccount`, `compareForAccount`, `readSyncState`, `writeSyncState`,
`ensureSyncBaseline`, `guestPassportAvailable`, `importGuest(fence)`, `subscribe`, `dispose`, matching song adapter
signatures where shared. Reads return ownerVersion/namespace/value/generation,
historyEnabled/historyEpoch/settingsVersion/canWrite. The policy helper queues an empty Passport
and privacy floor inside the existing owner-fenced song-clear transaction, then
cleans mirrors only against the committed primary/policy. It imports no account
manager and does not form a store dependency cycle.

- [x] RED real-IDB cases: two accounts/tabs, paused owner readiness, delayed open,
  clear before/after held record, disabled history and off→on settings-version race, old-client epoch-only clear,
  stale backup publication/recovery, quota/corruption/future schemas, contradictory
  ahead policy, missing-primary vs remote-delete semantics and first-sync gating.
- [x] Implement owner/policy reads and writes in one transaction. Preserve song
  public interfaces and existing backup/like/unlike behavior. Clear Passport
  atomically on current-client Clear; reconcile old-client clears before disclosure.
- [x] Require new storage and all existing song storage/retention browser cases
  GREEN without retries; run relevant node suites and manifest. Explicit commit.

### Task 3: Existing sync, native boundary and additive database admission

Files: `sync-core.js`, `auth-ui.js`, `electron/auth-manager.mjs`, generated
`supabase/migrations/20261112033456_listening_passport.sql`,
`supabase/tests/rls_policies.sql`, `tests/passport-sync.test.mjs`,
native auth/adapter tests and `tests/auth-local-gotrue.test.mjs` as appropriate.

- [x] RED five-key tests: Passport after songs, cross-client CAS/clear/tombstones,
  concurrent positive additions, offline/stale-policy merge, no page reload for a
  Passport-only update, explicit guest adoption and preserved four-key behavior.
- [x] Add262,144-byte native/SQL key admission, preserving all prior limits and
  RLS/owner/RPC/revision/grant semantics. No new role/table/provider/secret. Inspect
  hosted structure read-only before any eventual schema operation.
- [ ] Exercise native sandbox/auth/restart and full node suites locally. Local DB
  is unavailable; validate migration and Auth/pgTAP in existing isolated CI before
  hosted application. Never promote a pending database gate to a pass.

### Task 4: Library, atlas, qualified observation and transfers

Files: create `site/assets/passport-ui.js`, `site/assets/user-transfer.js` and
`tests/e2e/passport.spec.mjs`, `tests/e2e/passport-ui.spec.mjs`;
modify `discovery-ui.js`, `responsive-ui.js/.css`, `vector-atlas.js`, `site/index.html`,
all six `site/i18n/` catalogs and authoritative runtime plus its reference export/
import handler. Update `site/privacy.html`, website privacy and `docs/PASSPORT.md`.

Interfaces: `currentPlaybackStation()` from discovery returns a clone
`{station,programKey}` or null from its installed adapter. New UI uses actual audio
samples and existing `stationPlace`; persisted observations contain only places,
days and fences. General transfer wraps legacy schema1 with optionalPassport,
captures/rechecks owner, accepts old and Passport-only formats, and reports
partial failure instead of claiming everything imported. No credential fields.

- [ ] RED UI/transfer cases: exact60s progressing silent media earns a place;
  selection/hover/like does not; held/invalid saves cannot credit another account;
  history-off explains empty view; Clear removes totals/shading/backups; exports
  include correct own Passport and imports add only explicit positive entries.
- [ ] Add Passport to Library, wrap section controls safely, provide totals/list/
  exports/imports/guest-add and appropriate empty/loading/recovery/capacity copy.
  Preserve all existing tabs and UI actions. Add all locales and clear focus rules.
- [ ] Country shading composes with theme and country polygons, clears on privacy/
  owner change, and does not force map loading or alter station locations.
- [ ] Require phone/desktop/Paper/Night/RTL/keyboard and actual media cases GREEN;
  preserve search/filter/failover/song/auth regressions. No operating-system IME,
  physical background playback or human fidelity claim from synthetic fixtures.

### Task 5: Full qualification, one review and bounded delivery

- [ ] Advance coherent0.35.0 module/runtime/worker identity, refresh provenance
  with frozen place replay as needed, manifests and docs. Run `npm run verify`,
  full no-retry browser suite, rendered matrix, desktop renderer/auth/restart.
- [ ] If needed, push an explicitly pending draft for isolated SQL/Auth CI after
  all locally available gates pass. Fix concrete failures; never deploy a failed
  migration. One fresh whole-feature review of final immutable source; re-grade
  findings and perform one tested fix pass. Record every ruling/declined scope.
- [ ] Exact-head checks/logs and actual preview; bounded reviewed migration and
  post-apply verification/advisors; expected-head merge; final-main and production
  checks and a bounded canary. Original profile/provider/vault remain untouched.
- [ ] Update Spaces with source/evidence/rollback and phase4 desktop publication
  status. Then continue ER-11, ER-09 and ER-10; the broader roadmap remains active.

New cost is the only question gate. Keep failed/RED evidence and prior releases;
no force pushes, tag replacement, destructive schema rollback or profile reset.
