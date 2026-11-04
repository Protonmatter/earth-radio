# Release model

Current release: [0.25.0 production record](RELEASE-0.25.0.md), including exact
deployment/artifact identities, bounded live qualification, local-only signing
exception and guarded rollback. It was initially uploaded directly from the verified
working tree. The user subsequently authorized a release pull request, CI checks
and merge into main to reconcile source control; GitHub check results must be read
for that exact source revision. No tag or binary GitHub Release is implied.

Earth Radio distinguishes three identities that must not be conflated:

1. A Git commit is the reviewable source and configuration state.
2. A CI run validates a specific Git commit on declared operating systems and retains a staged static artifact.
3. A Cloudflare Pages deployment serves a specific uploaded artifact at a public URL. A direct working-tree upload must carry file hashes and must not be described as reproducible from its Git metadata alone.

`npm run release:manifest` produces deterministic `RELEASE_MANIFEST.json` and `sha256sums.txt` files for the candidate tree, including the Supabase configuration, migrations, and RLS tests. The files contain no wall-clock timestamp, so repeated execution against unchanged inputs produces identical output. `npm run verify` performs a non-writing equivalence check and fails CI when either committed file is stale. `.build/site/asset-manifest.json` independently records the publish boundary.

No public repository, tag, GitHub Release, signed desktop installer, or Cloudflare deployment is created by local verification. Those are separate external mutations and require explicit authorization and post-action verification.

If tags are introduced later, use an annotated version tag only after CI passes for the exact commit and the release notes accurately distinguish recovered source from original source. Desktop binaries must not be described as trusted or signed unless Authenticode/notarization is completed and verified on the produced artifacts.
