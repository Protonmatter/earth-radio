# Earth Radio 0.29.0 compact player and song library

Version 0.29.0 centers the song feed in a compact Now Playing card, groups playback
and station controls, and moves detailed metadata into a separate dialog. Account
adds private Recently heard and Liked songs, explicit local-song import, export,
history controls and music-service track/search links. See [song behavior, security
and rollback](SONG_LIBRARY.md) and [installation](INSTALLATION.md).

The [v0.29.0 release](https://github.com/Protonmatter/earth-radio/releases/tag/v0.29.0)
is authoritative for publication status and final source/binary checksums. Production
is [Earth Radio](https://earth-radio.pages.dev/). Shell generation is
`earth-radio-shell-v62-song-library`; the runtime filename is derived from its final
content. Electron remains locked to 43.8.7. No new dependency or paid service is added.

| Platform | Asset |
| --- | --- |
| Windows ARM64 installer | EarthRadio-Setup-0.29.0-arm64.exe |
| Windows ARM64 portable | EarthRadio-Portable-0.29.0-arm64.exe |
| macOS Apple Silicon | EarthRadio-0.29.0-macOS-arm64-unnotarized.dmg |
| macOS Intel | EarthRadio-0.29.0-macOS-x64-unnotarized.dmg |

`SHA256SUMS.txt`, `BUILD-PROVENANCE.json`, platform verification receipts and
`INSTALL.md` accompany the builds. Preserve all prior published release assets.
Windows retains the accepted local signer/timestamp; Mac builds remain ad-hoc and
unnotarized. Public operating-system trust is not established.

Before publishing, require the full local verification suite, browser regressions,
rendered matrix, standalone directory/HLS/navigation, native renderer/auth checks,
and both Supabase jobs. All exact-head PR and final main checks must pass. Apply
the reviewed additive migration before the new client reaches production. Compare
served production bytes/headers and the active worker with the staged artifact.
Build all desktop platforms from the same final main commit, verify packaged source,
architecture, signatures, startup and every draft/public download hash. Record final
identities in release provenance and the existing Spaces operations page.

The phone regression also guards Leaflet animation on a zero-size hidden map;
successful selection publishes its canonical identity before presentation. Short
landscape views start with filters collapsed so playback remains reachable.
Physical iOS/iPadOS, physical Mac installation, trusted signing/notarization and
all-station availability remain separate qualification boundaries.
