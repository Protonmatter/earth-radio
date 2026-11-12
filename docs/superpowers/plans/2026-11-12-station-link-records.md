# Station Link Records Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by
> task. Implementation stays with the primary agent; one independent review gate.

**Goal:** Publish bounded station records for ER-09 without changing existing boot
snapshots, country expansion, saved identities or account behavior.

**Architecture:** An explicit public projection of all normalized rows is divided
into256 deterministic content-addressed shards, with a separate optional manifest.
The existing scheduled producer and main-only atomic Pages publisher carry it.

**Tech Stack:** Node 24, npm, existing GitHub Actions/Pages, no new dependencies.

**Spec:** [Station sharing](../specs/2026-11-12-station-sharing-design.md).

## Global constraints

-256 shards;256 KiB/1,024 records each;64 KiB manifest;75,000 total identities.
- Existing aggregate128 MiB artifact guard and strict schema 2 stay intact.
- No audio/network/account requests in the pure index builder; public fields only.
- Do not change web0.36.0/runtime/v80 for this producer-only prerequisite.
- Only new cost requires a user question. Preserve all frozen worktrees/stash.

## Review focus

- A long-tail or sibling UUID absent from the boot catalog still resolves.
- Identical input in another order generates identical shard bytes and hashes.
- A valid manifest cannot admit path escapes, count mismatch or tampered bytes.
- A missing optional manifest stages the old format; a malformed present one fails.
- Publication cannot partially replace the last-good artifact or exceed128 MiB.

## Task1 — Bounded index and publication

Files: new `server/station-record-protocol.mjs`,
`scripts/build-station-record-index.mjs`, `tests/station-record-index.test.mjs`;
modify `scripts/build-directory-snapshot.mjs`,
`scripts/stage-directory-snapshot.mjs`, `tests/directory-publication.test.mjs`,
`package.json`, `.github/workflows/directory-snapshot.yml`.

- [x] RED manifest validation, all identities/aliases/long-tail, explicit field
  projection, deterministic sharding, budgets and publication rejection tests.
- [x] Implement `buildStationRecordIndex(stations, identity)` returning
  `{manifest, files: Map<string, Buffer>}` and `validateStationRecordManifest`.
- [x] Integrate generation/write/staging; stage absent optional files compatibly.
  Keep all existing catalog/country byte payloads unchanged on identical input.
- [x] GREEN focused producer suite and retained 52,630-row replay, including all
  existing descriptor/hash comparisons and full staged artifact budget.

## Task2 — Documentation, review and delivery

Files: `docs/DIRECTORY_PUBLICATION.md`, `docs/QA-0.36.0.md`,
previous ER-11 plan, `docs/provenance/web-0.36.0.json`, canonical manifests.

- [x] Reconcile accepted ER-11 records without changing historical failures.
- [x] Run `npm run verify`; inspect diff, canonical bytes and no dependency drift.
- [ ] Fresh whole-feature review and bounded corrections with repeat checks.
- [ ] Commit/push PR, actual feature-branch publisher build with no deploy,
  exact-head CI and reviewed source; expected-head merge and final-main CI.
- [ ] Qualify actual public station manifest, all shard hashes/counts/bounds,
  existing boot/country endpoints, and update Spaces with rollback/evidence.
- [ ] Continue ER-09 app sharing and ER-10; desktop publication follows.
