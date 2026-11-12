# Station link record prerequisite qualification

Base: accepted main `80e3ee014bae96dbb13b318cb1c82fb147d3af3d`.
This is publisher support for ER-09. App version 0.36.0, runtime, worker v80,
accounts, provider configuration, database and published desktop 0.34.1 are unchanged.
The player Share control and `/s/{id}` response are follow-on work.

## Local evidence on November 12, 2026

- `npm run verify`: 799 passed, three existing Windows skips, no failures;
  lint, syntax/repository guards, metadata/desktop proxy smoke, staged app/website
  validation and 497 canonical source hashes passed. No dependency/lock drift.
- The focused directory suite passed 68 cases before the additional frozen-proof
  assertion was added; that assertion passes in the full repository campaign.
- RED→GREEN tests cover absent new APIs, optional publication, malformed identity,
  wrong bucket assignment, inconsistent immutable descriptors and adopting an
  existing output directory. Hash tampering, linked input directory, record/byte
  budgets, concentrated buckets and the existing 128MiB payload guard also pass.
- The [retained-data proof](provenance/station-record-index-replay.json) binds four
  current implementation files. Input: 29,937,269 bytes, SHA-256
  `2ae63f727ae12ee9b27ccca2d632d9feb5972d11147ae3559681646880a4f597`,
  containing 52,630 already normalized public rows. Every existing boot/country
  descriptor and all 451 payloads match the accepted producer exactly. All eleven
  cities retain at least five qualified programs after grouping.
- All 52,630 identities occur exactly once in 256 shards. Reversed input and a
  changed generation timestamp produce identical shard bytes/hashes. The maximum
  shard is 146,553 bytes/256 records; total index 29,943,115 bytes. Final staging:
  710 files/79,846,665 payload bytes, beneath128MiB. The synthetic source SHA in this
  local proof is explicit and does not identify a deployed release.

Independent review, exact-head/main CI, a real feature-branch publisher build and
public manifest/shard readback remain delivery gates. Existing app browser/native
behavior is byte-identical; hosted CI still exercises its full browser/native
matrix. Public publication alone does not qualify a new share route, physical
mobile share sheets, installed apps, provider sign-in or audio fidelity.

## Independent review and containment correction

The complete review of ac85c00 found one P2 and no P0/P1 issues. It independently
passed all69 focused cases,498 canonical hashes and the retained-data replay,
including all451 old payloads and52,630 identities. Its filesystem experiments
demonstrated that a junction at the source root or an output ancestor could escape
the lexical `.build` boundary. This predates the feature but contradicts the new
explicit boundary promise, so it is included in the correction rather than deferred.

Three new tests reproduced linked source-root, intermediate-source-ancestor and
target-ancestor escapes before correction. The stager now inspects the trusted
build anchor and every existing path component, rejects links/junctions and checks
physical containment before reading manifests or creating output. It still uses
exclusive output-directory creation. All three cases pass without creating an
output or modifying the external marker. The retained publication was staged
again with current code and its proof hashes refreshed. Corrective full verification
passes 802 tests with three existing Windows skips and 498 canonical hashes. The
same reviewer's hash-bound follow-up remains required before push.

Review scope rulings: app Share/path/preview/title behavior remains the explicit
next PR; hosted CI/publication/readback remain delivery gates; historical ER-11
acceptance is reconciled from its retained receipt rather than re-audited. Physical
share sheets, provider sign-in, accessibility and audio fidelity are not established
by producer tests. These boundaries are retained, not treated as waived requirements.

## Operations and rollback

The [publication runbook](DIRECTORY_PUBLICATION.md#station-records-for-shared-links)
documents formats, limits, main-only publication and old-generation compatibility.
On failure the prior Pages deployment stays active. Correct the producer in a
forward commit and dispatch the existing workflow, or redeploy a retained verified
artifact. Do not change account/SMTP/vault settings, release assets or saved UUIDs.
No paid resource or new dependency is required.
