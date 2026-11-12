# Earth Radio 0.34.0 release qualification

[v0.34.0](https://github.com/Protonmatter/earth-radio/releases/tag/v0.34.0) is
published as release **442317988**, dated November 11, 2026 at 23:55:27 UTC.
It packages Today, Continue, place-first station facts, stream choice in Details
and the directory coverage correction. All six desktop builds match release
source `9fefbd0a1b295a79857a9fafd7a127b399061536`. Annotated tag object
`b3dc7826124e2e0f083ba0f7ab1d3574d164d371` and its remote peeled target were verified.
All thirteen draft downloads and thirteen anonymous public downloads passed full
size and SHA-256 checks. Previous release tags and assets were preserved.

## Downloads and installation

| Computer | Installer | Portable |
| --- | --- | --- |
| Windows ARM64 | [Setup](https://github.com/Protonmatter/earth-radio/releases/download/v0.34.0/EarthRadio-Setup-0.34.0-arm64.exe) | [Portable](https://github.com/Protonmatter/earth-radio/releases/download/v0.34.0/EarthRadio-Portable-0.34.0-arm64.exe) |
| Windows x64, Intel or AMD | [Setup](https://github.com/Protonmatter/earth-radio/releases/download/v0.34.0/EarthRadio-Setup-0.34.0-x64.exe) | [Portable](https://github.com/Protonmatter/earth-radio/releases/download/v0.34.0/EarthRadio-Portable-0.34.0-x64.exe) |
| Apple Silicon Mac | [Unnotarized DMG](https://github.com/Protonmatter/earth-radio/releases/download/v0.34.0/EarthRadio-0.34.0-macOS-arm64-unnotarized.dmg) | — |
| Intel Mac | [Unnotarized DMG](https://github.com/Protonmatter/earth-radio/releases/download/v0.34.0/EarthRadio-0.34.0-macOS-x64-unnotarized.dmg) | — |

Download the matching file and [checksums](https://github.com/Protonmatter/earth-radio/releases/download/v0.34.0/SHA256SUMS.txt).
The [release installation guide](https://github.com/Protonmatter/earth-radio/releases/download/v0.34.0/INSTALL.md)
and [current guide](INSTALLATION.md) cover Windows, macOS and Safari Home Screen
installation on iPhone/iPad. No account is required to listen. The production app
is [app.earthradio.stream](https://app.earthradio.stream/); the website and downloads
are [earthradio.stream](https://earthradio.stream/).

Windows uses the previously approved local Authenticode signer with RFC3161
timestamps. It does not provide public Windows publisher trust. Both macOS DMGs
are ad-hoc signed and explicitly unnotarized. No trust-store change, private-key
export, new paid signing service or Apple enrollment was performed.

## Completed qualification

- PR49 head and final main passed all ten required checks. Each hosted browser
  log reports **332 passes with no flaky cases**. Final-source runs are
  [CI 43118259037](https://github.com/Protonmatter/earth-radio/actions/runs/43118259037)
  and [Supabase 43118259186](https://github.com/Protonmatter/earth-radio/actions/runs/43118259186).
  Local producer verification passed 679 tests, three existing Windows skips and
  441 canonical source hashes; 46 focused producer/protocol cases and 37 targeted
  Chromium/WebKit directory/loading cases passed. Independent producer review
  found no findings. Earlier ER-05 browser/rendered/native lifecycle evidence
  remains dated evidence for the unchanged application assets.
- Actual production matched 106 public files on each app origin and 19 website
  files, including exact cache/security policy. Fifteen route checks, four
  account-enabled Chromium/WebKit phone/desktop contexts and the installed-worker
  offline shell passed. Classic Vinyl reached buffered playback while muted.
  Provider controls were checked; fresh live provider sign-in was not repeated.
- The producer preserves five qualified program witnesses for each curated city
  before clipping the root to 10,000 identities. Current qualification generation
  `2026-11-11T23:23:12.183Z` has 9,411 groups. Both public representations on both
  origins match current manifest payload hashes, stable ETags/304 and all eleven
  city minima. Actual native aggregation and the loopback route retain every
  minimum with 3,279 rows and one root read. Dublin retains five programs.
- All six builds match **128 application files** and complete locked-builder
  production metadata, including the unchanged `earth-radio` profile identity.
  Windows setup/portable pairs match **87 physical payload files** per package;
  application PE machines are ARM64/AA64 and x64/8664. Isolated startup passed.
  Four Windows artifacts passed local signer/chain checks, primary/nested CMS
  verification and fully consumed RFC3161 tokens bound to their primary signer.
- Real ARM64 and emulated-x64 portable guests passed live search, muted Classic
  Vinyl playback, favorite retention, saved volume at 61%/37%, restored Continue
  and no autoplay after restart. Each completed two normal File → Exit cycles;
  owned wrappers and main processes were absent afterward. The x64 HTTPS filter
  reduced Seoul results from 21 to seven; removing its chip restored 21 while
  preserving the query and stopped state. Both guest diagnostics showed the
  current snapshot. The original account profile was untouched.
- Native Mac CI verified both architectures, DMG integrity, read-only mounting,
  ad-hoc signing, approved packaged icons and startup. Independent read-only
  inspection of both downloaded DMGs also matched all 128 files and complete
  production metadata. Those verified DMG bytes were renamed for publication.
- All thirteen draft downloads and thirteen anonymous public downloads passed
  full sizes/SHA-256, including the checksum file and every one of its twelve
  entries. Latest-release readback matched. The previous v0.32.1 eleven-asset and
  v0.32.2 thirteen-asset identities, sizes, hashes and publication times were
  rechecked unchanged.

The machine-readable [release receipt](provenance/release-0.34.0.json) records
artifact IDs, sizes, SHA-256 values and the tested scope. Published support files
also include [build provenance](https://github.com/Protonmatter/earth-radio/releases/download/v0.34.0/BUILD-PROVENANCE.json),
[production parity](https://github.com/Protonmatter/earth-radio/releases/download/v0.34.0/PRODUCTION-PARITY.json),
[Windows verification](https://github.com/Protonmatter/earth-radio/releases/download/v0.34.0/WINDOWS-VERIFICATION.json)
and both `MACOS-VERIFICATION-*.json` receipts. Private guest profiles and credentials
are excluded from public artifacts.

## Reproducibility and publication order

Keep the release source frozen through package and public-download qualification.
Run the repository verifier and relevant browser/rendered/native checks, require
all hosted gates, accept actual previews and production, then build Windows and
take both native Mac candidates from that exact merged source. Require complete
production package metadata and source hashes; a version label alone is insufficient.
Use the established [Windows/Mac release workflow](RELEASE-0.32.2.md) and
[directory publication runbook](DIRECTORY_PUBLICATION.md).

The tagged source retains the installation document that existed at source
freeze. Release `INSTALL.md` is a deterministic edition with current artifact
names, Today/Details/Atlas/Library labels, dated provider qualification and
immutable documentation links. Its input/output hashes are recorded in
`BUILD-PROVENANCE.json`. This follow-up adopts that exact hash-verified published
guide into the current repository after the public download gate. Application
payloads and the immutable tag are unchanged.

The website updater consumes the owned repository's **published** release JSON.
It previews by default, makes no network call and changes only the curated
metadata and derived HTML when explicitly applied:

```powershell
node scripts/set-published-release.mjs --input .build/public-release-0.34.0.json
node scripts/set-published-release.mjs --input .build/public-release-0.34.0.json --apply
npm run release:manifest
npm run verify
```

Structural updater success does not establish download integrity. Keep the
separate full anonymous download receipt. The updater rejects downgrades and
changed asset identities under an existing tag. Staging stamps all six links,
the guide, checksums and version into static HTML for JavaScript-disabled clients;
a stale API response cannot downgrade the qualified fallback. After merge, check
actual served bytes/headers/routes and the download links with and without JavaScript.

## Limits and rollback

City minima count metadata programs, including HTTP streams. They do not establish
five HTTPS-playable streams, current availability of every station, human hearing
or physical studio position. Windows local signing and ad-hoc Macs retain their
stated trust limits. Windows x64 runs under ARM emulation here;
installer extraction is not physical installer/upgrade execution. Physical
iOS/iPadOS/Android installed-app behavior, Mac/Intel-Windows installation and
upgrades, screen readers and human audio fidelity remain separate qualification.
Fresh live OAuth/email signup, delivery and cross-client mutation sync remain
dated evidence rather than results of this release's synthetic native tests.

For a website/download regression, revert only the metadata/documentation change
through a reviewed forward commit, regenerate the manifests and rerun validation.
The updater intentionally refuses an accidental downgrade; use the documented Git
rollback rather than replacing same-tag asset identities. Keep download metadata,
derived HTML and the guide coherent. For an application rollback, restore a
complete preceding deployment and advance shell identity on a forward correction.
Preserve every published tag/asset and original account, provider, SMTP and vault
setting. Do not clear user profiles or rotate credentials as a rollback step.
