# Station Sharing App Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task by task. Primary
> agent implements; one fresh whole-feature review seat after local qualification.

**Goal:** Complete ER-09 public station paths, server previews, player Share/copy
and a trusted playback title while preserving legacy/native behavior.

**Architecture:** The published small-record index feeds a bounded Pages Function
which renders the existing shell plus an inert verified station record. A small
entry/Share controller uses existing selection/cache owners; Media Session's owned
presentation adapter also updates the document title.

**Tech Stack:** Existing Node24/npm/Pages/Electron/Playwright; no new dependencies.

**Spec:** [Station sharing app](../specs/2026-11-12-station-sharing-app-design.md).

## Global constraints

- Base accepted9497438; only new cost requires a question.
- Existing snapshot schema2 and station-link schema1/256KiB/1024rows/64KiB manifest
  and128MiB publication guards stay unchanged, including encoded URL bounds.
- No new audio owner, IPC, account/schema/provider/SMTP/vault or telemetry changes.
- Canonical links contain only public station IDs; no autoplay or private data.
- Web0.37/v81; leave four raw map blobs and desktop0341 assets unchanged.

## Review focus

- A link outside both directory cutoffs selects the exact identity on fresh/cached
  boot; it cannot silently become last played, or autoplay.
- Metadata names and URLs with quotes, script delimiters, Unicode and long encoded
  components remain data in both the HTML preview and inert bootstrap.
- Missing/stale/removed shards, unavailable optional APIs and canceled/late work
  fail honestly without unsafe egress, unbounded work or cross-request I/O reuse.
- A generated Function document keeps the full static security policy, correct
  canonical identity, root asset paths and real404/503/method semantics.
- Stop and unsupported Media Session preserve a truthful document title, native
  file paths, shared/current station selection and prior privacy/offline fences.

## Task1 — Public protocol, bounded lookup and real route

Create `site/assets/direct-stations.js`, `site/assets/station-record-protocol.js`,
`site/assets/sharing-core.js`, `functions/_shared/station-records.js`,
`functions/_shared/share-document.js`, `functions/s/[[path]].js` and focused
`tests/sharing-core.test.mjs`, `tests/station-share-reader.test.mjs`,
`tests/station-share-route.test.mjs`.
Modify `server/station-record-protocol.mjs` (compatibility re-export),
`site/assets/pinned-stations.js`, `site/_routes.json`, `package.json`, frozen
station-record proof/tests, and `tests/e2e/serve-site.mjs` as needed.

Interfaces: `publicStationId(value)`, `stationShareUrl(id)`,
`parseStationSharePath(pathname)`, `stationSharePayload(station,{locale})`,
`createStationRecordReader(options).lookup(id)`,
`renderStationShareDocument(html,station)`, and a GET/HEAD Pages `onRequest` handler.
Lookup returns a verified public row or null, with explicit unavailable errors.

- [x] RED ID/Unicode/escape/DTO cases, deadline/byte/cache/remove-shard behavior,
  methods/404/503/security/template integrity and long-tail/direct identities.
- [x] Extract pure data/protocol with unchanged exports and bytes; update fifth
  proof input and replay all707 payloads against the accepted producer.
- [x] Implement bounded request-owned lookup and controlled HTML rendering with
  explicit header policy and inert record; real route and loopback adapter.
- [x] GREEN focused tests, actual returned HTML/assets and existing route/snapshot
  tests, with no new root directory request or audio/counter side effect.

## Task2 — Entry, compact Share controls and title

Create `site/assets/sharing-entry.js`, `site/assets/sharing-ui.js`,
`tests/sharing-entry.test.mjs`, `tests/sharing-ui.test.mjs`,
`tests/e2e/station-sharing.spec.mjs`.
Modify `site/index.html`, `site/assets/listening-room.css`, `pinned-stations.js`,
`media-session.js`, its focused tests, all six `site/i18n` catalogs and the owned
runtime/reference `src-recovered/main.ts`, `src-recovered/core/player.ts` if needed.

- [x] RED path/legacy/long-tail/cache no-autoplay, correct shared identity, share
  payload/cancel/clipboard failure/manual copy, keyboard/focus/mobile/RTL cases.
- [x] Validate/bootstrap through existing live/cache merger; canonicalize only
  shared web entry; leave native and ordinary OAuth/root query paths untouched.
- [x] Add compact owned Share UI and selection callback; retain existing Play
  resolution and asynchronous disposal fences, with no additional status polling.
- [x] RED/GREEN playing/station/paused/Stop/late-title and native-API-absent cases;
  preserve media/artwork/transport behavior. Narrow module-relative SW registration.
- [x] Complete locale coverage and run focused browser, native renderer and
  existing search/filter/playback/account/Passport regressions.

## Task3 — Release identity and full qualification

- [x] Coherent0.37/v81/runtime fingerprint, dependency version URLs, shell graph,
  controlled provenance, unchanged-map and frozen place/producer proofs.
- [x] Reconcile accepted PR55 plan/QA/receipt in docs; document sharing/privacy,
  current qualification/rollback and remaining physical/provider boundaries.
- [x] `npm run verify`, complete zero-retry browser suite, rendered/native checks,
  actual v80→v81 retention/offline test and working/index blob validation.
  Commit blobs are a separate post-commit delivery check below.
- [x] One fresh whole-feature review; grade all findings and declined scope,
  correct/test bounded follow-ups with the same seat before publishing.

## Task4 — Delivery and continuation

- [ ] Commit/push PR, attach it, clean exact-head CI/review and actual HTTPS
  preview routes/OG/header/asset/UI/lookup/offline qualification.
  Verify every canonical commit blob before the push.
- [ ] Expected-head merge, identical tree, final-main CI/logs and production
  readback/canary; preserve profiles/providers/stash/worktrees/releases.
- [ ] Spaces exact guarded edits/readback and clean root synchronization.
- [ ] Continue ER-10 installation, phase-four desktop publication and phase five.
  Do not stop at this intermediate feature.
