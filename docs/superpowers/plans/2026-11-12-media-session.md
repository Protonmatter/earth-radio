# ER-11 implementation and delivery

Design: [track-level Media Session](../specs/2026-11-12-media-session-design.md).
Base: accepted Passport main `7e5e33b0ccc52c9cff016ae53c28ff5196a9be09`.
Workspace: `.build/media-session-worktree`, branch `feat/media-session`.
User delegated implementation/design; only new cost requires a question.

## Task1 — Metadata and artwork contracts

- [x] RED pure metadata cases and actual-browser known-track/Stop regressions.
- [x] Add pure station/song projection and a bounded trusted-cover loader with
  truthful 96/256/512 PNG sizes, memory-only cache and first-party brand fallback on capability/network failure.
- [x] Prove Unicode/unknown place, wrong owner station, URL/content/byte/pixel
  limits, aspect ratio, abort and capacity behavior without changing input data.

## Task2 — Controller and audio ownership

- [x] RED supported/unsupported individual actions, late results and no autoplay.
- [x] Add the lifecycle controller using the existing promoted-song subscription
  and owned callbacks, with generation fences and proper state/clear/disposal.
- [x] Integrate the runtime and mirror reference TypeScript. Add explicit Stop
  ownership/late-event/replay behavior; route raw ICY refresh through the trusted
  publisher. Preserve current-list and successful-selection event gates.
- [x] GREEN actual MediaMetadata, canvas outputs, pause/resume, Stop/replay,
  delayed source/HLS/image races and existing playback/search/Passport/account suites.

## Task3 — Coherent release and full qualification

- [x] Advance web0.36.0/runtime/v80 identity and offline dependencies. Refresh
  controlled provenance, unchanged-input place replay, manifests and docs.
- [x] Reconcile Passport delivery records using its exact head/main/CI/served/
  hosted SQL/recovery evidence; keep desktop publication explicitly at0.34.1.
- [ ] Full verify, complete zero-retry browser suite, rendered42 and native
  sandbox/sync/restart/lifecycle/renderer gates; canonical Git blob checks.
- [ ] One fresh whole-feature review after local gates; re-grade findings and
  perform one tested correction pass if needed. Preserve every concrete ruling.

## Task4 — Bounded delivery and continuation

- [ ] Checked commit/push, existing-source PR, all exact-head CI and actual
  preview artifact/header/route/UI/offline acceptance.
- [ ] Expected-head merge, final-main CI/logs, served production and bounded
  canary. Preserve original profiles/providers/SMTP/vault and prior releases.
- [ ] Update Spaces with evidence/rollback and honest platform boundaries.
- [ ] Continue ER-09 sharing, ER-10 installation, then phase4 desktop builds/
  publication and the approved phase5. Do not stop at this partial roadmap.
