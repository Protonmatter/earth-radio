# Release model

Earth Radio distinguishes three identities that must not be conflated:

1. A Git commit is the reviewable source and configuration state.
2. A CI run validates a specific Git commit on declared operating systems and retains a staged static artifact.
3. A Cloudflare Pages deployment serves a specific commit-derived artifact at a public URL.

`npm run verify` produces deterministic `RELEASE_MANIFEST.json` and `sha256sums.txt` files for the candidate tree. The files contain no wall-clock timestamp, so repeated execution against unchanged inputs produces identical output. `.build/site/asset-manifest.json` independently records the publish boundary.

No public repository, tag, GitHub Release, signed desktop installer, or Cloudflare deployment is created by local verification. Those are separate external mutations and require explicit authorization and post-action verification.

If tags are introduced later, use an annotated version tag only after CI passes for the exact commit and the release notes accurately distinguish recovered source from original source. Desktop binaries must not be described as trusted or signed unless Authenticode/notarization is completed and verified on the produced artifacts.
