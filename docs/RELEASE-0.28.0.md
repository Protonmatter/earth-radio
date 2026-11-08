# Earth Radio 0.28.0 geographic atlas release

Version 0.28.0 adds readable, bounded station tooltips and a bundled geographic
atlas: country/city label switches, country/regional borders, lakes, rivers and
selected roads. More detail appears as you zoom. Preferences are remembered on
this device. The approved Paper/Night design and existing station discovery,
playback, sign-in, encrypted-session and account sync contracts are retained.

The [v0.28.0 release](https://github.com/Protonmatter/earth-radio/releases/tag/v0.28.0)
is authoritative for publication status, exact tag, source and binary checksums.
Production is [Earth Radio](https://earth-radio.pages.dev/). Runtime is
`index-fdff159e.js`, shell cache is `earth-radio-shell-v61-geographic-atlas`, and
Electron remains locked to 43.8.7. See [installation](INSTALLATION.md).

| Platform | Asset |
| --- | --- |
| Windows ARM64 setup | EarthRadio-Setup-0.28.0-arm64.exe |
| Windows ARM64 portable | EarthRadio-Portable-0.28.0-arm64.exe |
| macOS Apple Silicon | EarthRadio-0.28.0-macOS-arm64-unnotarized.dmg |
| macOS Intel | EarthRadio-0.28.0-macOS-x64-unnotarized.dmg |

`SHA256SUMS.txt`, `BUILD-PROVENANCE.json`, platform verification receipts and
`INSTALL.md` accompany the applications. Published older releases remain immutable.
Windows retains the accepted local/self-signed certificate and timestamp; Mac
builds remain ad-hoc signed and unnotarized. Public trust is not established.

## Gates and evidence

Before commit, run `npm run verify`, `npm run test:e2e`, `npm run test:rendered`,
standalone directory/HLS/navigation checks and native renderer/auth checks. All
exact-head PR checks must pass before merge, followed by all main checks. Build
Windows and both Mac architectures from that same final commit. Compare every
packaged application source by hash, verify package payloads, architecture,
signature/timestamp limits, bounded startup and downloadable asset hashes.

Compare production bytes/SHA-256 against the staged manifest, verify response
headers and active shell generation, and preserve strict-public fetch routing
and the private metadata quota binding. Final source, CI, deployment and binary
identities belong in release provenance and the Spaces operations record.
See [qualification scope](QUALIFICATION-0.28.0.md).

## Data and rollback

[Map provenance](MAP_DATA.md) records pinned public-domain Natural Earth inputs,
deterministic curation, lazy-load thresholds, output hashes and limits. No tile
subscription, key, new dependency, telemetry or credential is added. Natural Earth
permits unrestricted data use but is generalized rather than address-level mapping.

For desktop rollback, export preferences/favorites, close the app, install the prior
verified package for the same architecture and preserve profiles/OS credentials.
For web rollback, restore the prior verified source artifact with a newer shell
cache generation while retaining guarded Functions and the private quota service.
Never replace published assets under an existing version tag.
