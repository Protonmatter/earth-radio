# Directory place minimum implementation plan

Goal: preserve five qualified programs per curated place in every production
root without additional network requests or changed station/location records.
Spec: [directory place minimum](../specs/2026-11-11-directory-place-minimum.md).

Review Focus:

- Count complete candidate-pool program components, never variants or centroids.
- Prefer existing prefix observations and protect all cities before eviction.
- Preserve UUIDs, row data/order, size limits, country views and stable hashes.
- Reject unmet minima or invalid bounds before artifact publication.
- Keep app/runtime/model/account/credentials byte-identical and retain existing
  source, CI, artifact and actual-served qualification gates.

## Task 1: Pure selection and reproduced cutoff

Files: new scripts/directory-place-selection.mjs and
tests/directory-place-selection.test.mjs; package test list and manifests.

- [x] Write missing-module RED tests with all eleven city fixtures, an actual
  three-Dublin-in-prefix/five-in-input cutoff, and adversarial program evidence.
- [x] Implement bounded deterministic selection with explicit protected witnesses,
  failure paths and a coverage report. Prove focused GREEN and full verifier;
  commit the inactive helper only after checks.

## Task 2: Production integration and qualification

Files: scripts/build-directory-snapshot.mjs; existing producer/generation and
publication fixtures; documentation/provenance and manifests.

- [ ] Reproduce the producer integration cutoff against the old slice.
- [ ] Use selection before global views, production minimum5, report coverage;
  preserve explicit small-fixture opt-outs and every prior assertion/limit.
- [ ] Qualify against retained complete publication input/country shards and live
  data; verify global/country shapes, hashes, every city and native sampling.
- [ ] Run full verify and appropriate changed-data/browser checks; demonstrate
  unchanged application assets and dependencies. Get one fresh read-only review,
  reproduce/fix concrete Important/Critical findings once, require green gates.

## Task 3: Reviewed delivery and resume desktop release

- [ ] Commit/push/create/attach PR; require ten exact-head checks and actual preview
  bytes/routes/UI. Exact-head merge, final-main gates and production acceptance.
- [ ] Run publisher from qualified final main; verify both representations/ETags
  on both origins and minimum5 for every city in actual native/loopback results.
- [ ] Update Spaces; freeze new source and rebuild six desktop candidates in a
  separate ignored workspace. Resume signatures/source/package/guest restart,
  immutable tag/draft/public download checks and published installation metadata.

User delegates choices and authorizes commits/push/merge/deploy/rebuild/Spaces;
only new cost requires a question. No cost is introduced. Retain ignored evidence
and ledgers, previous desktop candidates/releases, other worktrees and the owner
profile. No implementer agents; one fresh whole-branch reviewer at the end.
