# Earth Radio 0.27.0 listening room release

Version 0.27.0 ships the approved ivory, forest-green and copper desktop/mobile
interface, station artwork, compact rows, translated navigation symbols and quieter
map controls. Search precedes genre shortcuts; quick picks remain in More actions.
New profiles default to Paper and saved Night/Paper preferences remain persistent.
The account, sync, stream and directory contracts from 0.26.0 are retained.

## Identity and downloads

The [v0.27.0 release](https://github.com/Protonmatter/earth-radio/releases/tag/v0.27.0)
is authoritative for publication status, tag, checksums and exact build provenance.
Production is [Earth Radio](https://earth-radio.pages.dev/). The package version is
0.27.0, Electron is locked to 43.8.7, runtime is `index-a673e435.js`, and shell cache
is `earth-radio-shell-v59-state-sync-0-27-0`.

| Platform | Asset |
| --- | --- |
| Windows ARM64 setup | EarthRadio-Setup-0.27.0-arm64.exe |
| Windows ARM64 portable | EarthRadio-Portable-0.27.0-arm64.exe |
| macOS Apple Silicon | EarthRadio-0.27.0-macOS-arm64-unnotarized.dmg |
| macOS Intel | EarthRadio-0.27.0-macOS-x64-unnotarized.dmg |

`SHA256SUMS.txt`, `BUILD-PROVENANCE.json`, platform verification receipts and
`INSTALL.md` accompany the applications. See [installation](INSTALLATION.md) for
desktop and iPhone/iPad Home Screen instructions. Published older releases remain
immutable. The Windows signer remains local/self-signed and Mac builds remain
ad-hoc signed and unnotarized; no new trust enrollment is implied.

## Required release gates

Run `npm run verify`, `npm run test:e2e`, `npm run test:rendered`, the standalone
directory/HLS/navigation tests, and native renderer/auth checks before committing.
All exact-head PR checks must pass before merge. All main checks must pass for the
release source. Build Windows and both Mac architectures from that same commit,
compare every packaged application source by hash, verify signatures/architecture
and bounded startup, and verify the produced downloads before publishing.

Production must match the staged source asset manifest by bytes and SHA-256,
including the new stylesheet, runtime and shell cache. Retain strict-public fetch
routing and the private metadata quota binding; deployment success alone does not
prove served acceptance. Final deployment IDs, CI runs and hashes belong in the
release provenance, qualification evidence and Spaces operations record.

## Scope and rollback

The virtualizer now uses an 88px stride, 12px gap and one column. The presentation
adapter measures that stride; visible rows are 76px high. The maintained stylesheet
is additive. The runtime's selection, scroll-window algorithm, network and playback
handlers are unchanged. No dependency, map provider, analytics or credential was
added. The bundled land-only atlas does not supply the concept's illustrative city
labels or country borders.

Fixture regressions establish application behavior. Live directory/stream samples
are point-in-time checks, not guarantees of station availability or perceptual
fidelity. Physical Mac upgrades, installed iOS/iPadOS account returns and fresh
outside-team OAuth identity qualification retain the [existing limits](QUALIFICATION-0.26.0.md).

For desktop rollback, export favorites/preferences, close the app, and use the
prior verified installer of the correct architecture. Preserve profiles and OS
credentials. For web rollback, restore a previously verified source artifact with
a newer shell-cache generation while retaining the guarded Functions and private
quota service. Never replace published assets under an existing version tag.
