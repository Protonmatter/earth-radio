# Earth Radio 0.32.2 delivery gates

This candidate packages the qualified playback-intent, confirmed-play counter and
public-route changes, retains the approved identity, and adds Windows x64. It is
not a publication receipt. The final source, package and served evidence must be
recorded after each gate passes; do not infer physical acceptance from fixtures.

## Source and browser gates

Use the pinned Node/npm versions and locked dependencies. Run `npm run verify`,
the full Chromium/WebKit suite, rendered and native auth/restart checks. Preserve
UUID aliases, original account/sync keys, local collections and the directory
publication contract. Module URLs advance to 0.32.2 and the shell to
`earth-radio-shell-v73-desktop-0322`; derive the immutable runtime name with
`node scripts/fingerprint-runtime.mjs`. Map data bytes are unchanged.

The website's `published-release.js` is curated public release metadata.
`stage-website.mjs` validates it, stamps all download links/version labels into
HTML for JavaScript-disabled clients and emits the same record for the live UI.
An older or incomplete latest-release API response cannot downgrade that fallback.
Windows x64 links appear only when the complete pair is present; releases from
0.32.2 require the pair in addition to the four existing application assets.

While 0.32.2 is unpublished, fallback metadata remains on the previously verified
complete v0.32.1 release. Do not create public links to nonexistent draft assets.
After publication and full anonymous download hashing, update the record and its
source HTML bindings explicitly:

```powershell
gh api repos/Protonmatter/earth-radio/releases/tags/v0.32.2 | Set-Content -Encoding UTF8 -LiteralPath .build/public-release-0.32.2.json
node scripts/set-published-release.mjs --input .build/public-release-0.32.2.json
node scripts/set-published-release.mjs --input .build/public-release-0.32.2.json --apply
```

The first command is an authenticated read of public metadata. The two Node
commands perform local structural validation only and make no network calls.
Without `--apply`, no source file changes. Apply writes only
`website/published-release.js` and the derived bindings in `website/index.html`.
Targets must be regular files inside the repository. Input is capped at 256 KiB;
unknown fields are dropped. Downgrades and changed same-tag asset identities are
rejected. Exit 0 means the plan/apply succeeded, not that downloads were qualified;
exit 1 means validation or I/O failed. Keep the independent public-download receipt.

## Six desktop builds

Build Windows with `npm run dist:windows` for both ARM64 and x64. Normal packaging
does not select a personal certificate automatically. Supply the accepted local
signer through the reviewed release build configuration, never a committed private
key or password. Verify Authenticode identity/timestamps, PE architecture, extracted
installer/portable payloads and every packaged application source hash. Use isolated
profiles for startup, saved preferences and normal restart/quit; preserve the
original user profile. Extracting an installer is not an installed upgrade test.

The Windows wrapper requires the locked toolchain and runs ARM64, then x64,
serially. Each child has a twenty-minute limit; a failure stops before the next
architecture. `--config` is optional and must name a regular file within the
repository. It is forwarded to both runs, unlike appending options to a shell
chain. Both invocations force `--publish never`, regardless of inherited release
or CI environment; packaging cannot publish GitHub assets. For a reviewed ignored
release configuration:

```powershell
npm run dist:windows -- --config .build/release-windows.json
```

Exit 0 means both packaging commands succeeded; exit 1 means validation or a
child build failed. Builds do not install the application, change the trust store
or alter user profiles. Downloading the locked Electron/builder tools requires
network access; signing requires access to the already-approved private key in
the local certificate store. Actual binary/payload qualification remains separate.

Build both native macOS architectures from the exact immutable source with the
existing `scripts/macos-release.mjs` workflow. Verify DMG integrity, mounted source
hashes, native architecture, ad-hoc signature, approved icon and isolated startup.
Publish explicitly unnotarized filenames and retain the accepted macOS 12 minimum.
Public Windows signing and Apple Developer ID/notarization remain outside this
free release path; no trust store or security policy is changed.

Freeze source only after exact-head CI and previews pass. Use the documented
production route gate after rollout and compare actual served hashes/headers with
the staged artifacts. Publish a new annotated v0.32.2 tag and fresh release assets;
never replace prior-version files. The release needs six application files,
INSTALL.md, provenance, platform receipts, production parity and SHA256SUMS.txt.
Verify every draft download and every anonymous published download.

## Rollback and limits

Restore a prior coherent app/website deployment or revert the source and publish
a fresh worker generation. Desktop rollback uses the preceding published version,
with exports retained before profile/installer changes. Revert only the two public
metadata files to roll back download presentation, then restage/revalidate; the
metadata updater deliberately refuses an accidental downgrade.

Physical iPhone/iPad installed-app/provider returns, physical Mac/Intel-Windows
acceptance, original-profile installer upgrades, fresh outsider sign-up, screen
reader use and human audio fidelity are separate qualification. No paid resource,
provider/SMTP/schema/vault/credential setting, dependency or license change is part
of this release. Notifications and new analytics remain separate opt-in decisions.
