# Scheduled directory publication

Earth Radio publishes normalized public Radio Browser station metadata separately
from application source. No audio, account data, OAuth material or secrets enter
this artifact. The application license is unchanged.

## Build and publication

`.github/workflows/directory-snapshot.yml` runs hourly at minute 17 and supports
manual dispatch. The deploy job and existing github-pages environment both permit
only `main`. Manual feature-branch runs can validate/build artifacts, but cannot
publish them. GitHub schedules are best effort and can be delayed; public repositories
can have schedules disabled after 60 days without repository activity.
The producer uses the exact checked-out source SHA, bounded provider-host discovery,
10,000-row pages, at most three mirrors and a shared 120-second deadline. Repeated
pages, incomplete pulls, invalid data, fewer than 1,000 valid rows or fewer than
20 countries fail publication. A failed build leaves the prior deployment intact.

Normalization bounds fields, rejects private literal targets and credential-bearing
URLs, canonicalizes tags/languages, infers country codes only from nonconflicting
directory evidence, rejects implausible coordinates and deduplicates UUIDs. It does
not assert that a stream is currently playable. HTTP-only streams remain explicitly
marked. Browser mixed-content restrictions still apply. Separate programs, countries
and conflicting regional services remain distinct. Stream aliases keep every UUID.

The complete generation contains a versioned manifest plus content-addressed global,
country and compatibility JSON. SHA-256 values identify exact UTF-8 bytes. Generation
timestamps are metadata and do not make an unchanged payload's ETag change. Staging
verifies every referenced file before creating the deployable artifact and excludes
unreferenced files. The artifact has a 128 MiB aggregate limit. Source branches are
never modified by the publisher.

GitHub Pages must use **GitHub Actions** as its build source. Official actions are
pinned to immutable commits. Build has `contents: read`; only deployment receives
`pages: write` and `id-token: write`, using an ephemeral workflow identity. There is
no saved deployment key. The public project-site origin is
`https://protonmatter.github.io/earth-radio/`. The application serves data through
its finite same-origin `/directory/*` routes; native readers retain public-network
validation. Reader qualification and activation are separate from adding this
publication pipeline.

The repository is public. Standard public-repository GitHub Actions runners and
public GitHub Pages are available without adding a paid service. This is not an
unlimited hosting claim: Pages documents a 1 GB published-site limit and a soft
100 GB/month bandwidth limit. Do not enable paid capacity without owner approval.
References: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits),
[schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Local validation

Prerequisites: the repository's pinned Node version; no additional npm dependency
or credential is needed for the producer.

```powershell
node --test tests/station-variants.test.mjs tests/directory-normalize.test.mjs tests/directory-generation.test.mjs tests/directory-producer.test.mjs tests/directory-publication.test.mjs
node scripts/build-directory-snapshot.mjs .build/directory-generation-unique
node scripts/stage-directory-snapshot.mjs .build/directory-generation-unique .build/directory-publication-unique
```

Use fresh output directories: writes fail rather than replace an existing artifact.
Exit 0 means generation/staging passed; exit 1 means failure. The JSON output reports
counts, byte sizes, generation time and source identity without stream URLs. Treat
the source directory and staged directory as temporary artifacts, not source files.

## Operational checks and rollback

1. Inspect the latest **Directory snapshot** run and its exact source SHA; both jobs
   must succeed. Confirm the schedule remains enabled.
2. Read the public `manifest.json`. Validate its producer SHA, generation time and
   file hashes against the retained workflow artifact. Do not equate a successful
   build with a successful deployment or application readback.
3. Check application fresh/cached/stale responses and conditional ETags separately.
   Confirm legacy array clients still work before releasing a grouped client.
4. On a bad generation, disable this workflow's schedule and retain its logs and
   artifact. Redeploy a previously verified Pages artifact with the existing
   official deployment workflow, or correct the producer in a normal forward
   commit and dispatch it. Never rewrite source history or overwrite a release tag.
5. The frontend reader can be rolled back independently to its previous guarded
   implementation. Keep current metadata rate-limit bindings and strict-public
   routing in place. A snapshot outage must not alter account or sync state.

Publication alone does not qualify real audio fidelity, installed mobile/PWA behavior,
external-account signup, public Windows trust or macOS notarization.
