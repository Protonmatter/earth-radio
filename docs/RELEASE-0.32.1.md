# Earth Radio 0.32.1 precision identity

PR #36's approved precision identity is used by the app and public website. This
patch gives the desktop packages an immutable new version and uses the same
approved artwork for Windows executable/window icons and the macOS bundle icon.
The native Mac receipt verifies the mounted ICNS against the generated icon and
records its approved PNG source hash. No playback, discovery or account behavior
change is intended.

Mutable module URLs advance coherently to 0.32.1 and the shell cache to v69.
Regenerate the Windows ICO with `node scripts/build-desktop-icon.mjs`; use
`--check` to verify it. This uses the already locked electron-builder icon toolset
and its pinned download checksum. The approved rounded 512px PNG is also the
Mac iconset source; sips produces all standard slots, including the 1024px slot.
This is format conversion/resampling of existing artwork, not a new logo design.

Delivery requires local verify/rendered/native checks, exact-head CI, served
app/website hash and header parity, final-source Windows extraction/signature/
startup checks and both native Mac receipts. Publish a new annotated v0.32.1 tag
and new assets; never replace v0.32.0 or earlier downloads. Record final source,
deployment IDs and qualification results in release provenance and Spaces.

Windows retains the accepted local self-signed publisher and timestamps. Mac
builds remain ad-hoc signed and unnotarized. Preview approval authorizes delivery;
physical iOS/Android icon-cache and installed-app behavior, physical Mac upgrades,
original-profile Windows installer upgrades and human audio fidelity remain
separate qualification work.

Rollback uses a coherent verified app/website source and a newer shell generation,
plus a new desktop version if needed. Preserve existing tags, data, users, sender
records and credentials. Directory publication and fallback behavior are unchanged;
see DIRECTORY_PUBLICATION.md. No dependency, paid service, provider configuration,
schema, SMTP or vault change is included.
