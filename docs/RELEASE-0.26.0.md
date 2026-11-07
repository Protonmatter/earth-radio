# Earth Radio 0.26.0 desktop release

Version 0.26.0 enables Google, GitHub and verified email sign-in in Windows/macOS,
OS-encrypted session recovery, and per-user favorites, recent stations and preference
sync. It uses Electron 43.8.7, runtime `index-8fd01303.js` and shell generation v56.
The production web app is [Earth Radio](https://earth-radio.pages.dev/).

## Downloads and identity

The [v0.26.0 release](https://github.com/Protonmatter/earth-radio/releases/tag/v0.26.0)
is the authority for publication status, the immutable tag and downloadable assets:

| Platform | File |
| --- | --- |
| Windows ARM64 installer | `EarthRadio-Setup-0.26.0-arm64.exe` |
| Windows ARM64 portable | `EarthRadio-Portable-0.26.0-arm64.exe` |
| macOS Apple Silicon | `EarthRadio-0.26.0-macOS-arm64-unnotarized.dmg` |
| macOS Intel | `EarthRadio-0.26.0-macOS-x64-unnotarized.dmg` |

`SHA256SUMS.txt` covers the binaries, `INSTALL.md`, `BUILD-PROVENANCE.json` and
platform verification receipts. The provenance records the exact tag/build sources,
CI runs, architecture, binary sizes/hashes and comparison with production. The
repository's `sha256sums.txt` is a separate source inventory, not the download list.
Follow [installation](INSTALLATION.md) for platform selection, checksum commands,
account return and iPhone/iPad Home Screen installation.

Release preparation must start from a clean main tree with all exact-head checks
passing. Build Windows setup/portable using the existing local certificate and the
locked toolchain; build each Mac architecture on its native runner. Verify every
packaged application file against the release source and compare the staged public
files with production. Documentation-only revisions may differ from the preceding
production commit; application payload equality must be established by hashes.
Create an annotated tag only after CI passes. Replace assets only while the release
is still an unpublished draft, then verify remote sizes/digests and downloaded bytes
before publication. Preserve the older published tags and assets.

## Qualified behavior

The [qualification record](QUALIFICATION-0.26.0.md) preserves native vault, sandbox,
IPC, callback, account UI, logout failure/retry and lifecycle tests; browser/RLS and
real local GoTrue/Mailpit/PostgREST checks; isolated Windows install/upgrade tests;
and live Google/GitHub and email evidence. Real external Gmail signup/confirmation,
web-to-Windows favorite/preferences sync and native encrypted restart passed.

Production's application-source cut was `7998245b2d6b056947149149bed1c40abd83e3b7`.
Deployment `af9d0bf7-492e-4aea-86bd-23ab737a1f46` matched all 47 staged public files,
CSP/HSTS/cache policy and activated v56 service-worker control. Subsequent release
documentation commits require another deployment/source readback; the final release
provenance records that result without inferring it from a successful merge.

## Accepted limits

- Windows binaries use the accepted local self-signed publisher certificate and
  timestamps. Public Windows publisher trust is deferred; no Root certificate is
  installed as part of the release.
- macOS builds are ad-hoc signed and **unnotarized**, with no Apple Developer ID
  identity. Keep Gatekeeper enabled. The declared minimum is macOS 12; native CI
  used macOS 15 on Apple Silicon and Intel.
- Physical Mac provider consent, audio-device behavior and upgrades; installed
  iOS/iPadOS account returns; original-identity Windows upgrade; fresh outside-team
  OAuth identities and delivery to other mailbox providers remain unqualified.
- The isolated Windows lab established installer mechanics and guest-data migration
  with a separate application identity/GUID. The original local 0.24 installation
  was preserved; every existing user-profile migration is not inferred.

## Rollback

Export local favorites/preferences and close Earth Radio before changing installed
versions. Keep the prior installer and its published checksum; reinstall it only
after validating the correct architecture and provenance. Do not delete cloud user
tables, local profiles or encrypted credentials as a rollback shortcut. Version
0.25.1 desktop is local-only and does not provide the new account capability.

For web rollback, retain the current guarded Functions, strict-public routing and
private metadata quota binding while restoring a known-good static artifact. Follow
[Cloudflare deployment](CLOUDFLARE_DEPLOYMENT.md) and [operations](OPERATIONS.md).
Do not roll the whole deployment back to a pre-quota release or disable the limiter.
