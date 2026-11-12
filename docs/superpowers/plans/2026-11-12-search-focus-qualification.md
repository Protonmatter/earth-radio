# Search focus and durable-setting implementation plan

Spec: [qualification contract](../specs/2026-11-12-search-focus-qualification.md).
Base: `715f997e94bd6d1dd62386506f2904eed80e16ee` in the isolated
`fix/search-focus-qualification` worktree. No implementer agents.

Review Focus:

- Native focus ownership changes only the hidden search engine, preserving its
  programmatic filtering/keyboard bridge and the visible country/station fields.
- Controlled regressions use actual native focus and IDB events, preserve real
  persistence assertions and do not hide failures with retries or sleeps.
- No account/storage/provider/schema/ranking/data ownership changes.
- Coherent patch identity, canonical Git hashes and immutable prior releases.
- Keep actual served/native/package/guest/download gates distinct from fixtures.

## Task 1: Regression evidence

- [x] Add bounded focus and IDB timing fixtures.
- [x] Reproduce active-edit and composition focus loss in Chromium/WebKit before
  changing production code. Preserve RED logs and initial controlled receipts.
- [x] Add a durable-policy waiter and held-write/reload case; preserve all prior
  heard/liked/remove/undo/history and owner/privacy assertions.

## Task 2: Narrow correction and qualification

- [x] Hide the engine and focus the visible input synchronously; no other UX change.
- [x] Advance coherent0.34.1/v77 cache/import/runtime identity and provenance.
- [ ] Focused GREEN, complete verifier/browser (no retries), rendered/native and
  station discovery regressions. Review the diff and obtain one fresh whole-branch
  read-only review at feature end; reproduce/correct concrete findings once.

## Task 3: Hosted and desktop delivery

- [ ] Commit/push/create/attach PR after local gates. Ten exact-head checks,
  actual preview files/headers/routes/UI/offline, expected-head merge, final-main
  gates and actual production acceptance; require no flaky browser cases.
- [ ] Freeze final source and qualify current directory/native minima. Build all
  six desktop packages separately; source/metadata/signatures/payload/guest
  restart, new annotated tag and all draft/anonymous public hashes.
- [ ] Update current website/installation metadata after complete publication,
  require CI/actual served links and update Spaces without unrelated changes.
  Then resume the approved Passport and remaining roadmap stages.

New cost is the only user question gate. Retain the0.34.0 release, failed CI and
probe evidence, other worktrees/stash and every original account/provider/vault.
