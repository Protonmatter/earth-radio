# Songs and the compact player

The Now Playing card centers the current title, artist and station above grouped
transport controls. Like song is separate from Save station. Spotify, Apple Music,
Tidal and YouTube Music open in the external browser. Links say Search unless the
existing metadata pipeline supplies a verified catalog match and a valid track URL.
There is no new music-service account, subscription or API integration.

Song details opens a separate keyboard-accessible dialog. It shows available artist,
album, genre, release year and ISRC facts. Missing facts are omitted. Broadcast
provenance is collapsed; Identify song retains the existing canonical recognition
action and availability check. No artist biography is fabricated.

## Profile and privacy

Account contains Recently heard and Liked songs. A song enters Recently heard after
15 seconds of advancing playback, with an artist and title promoted by the metadata
pipeline for the selected station. Pause, stall, mute, zero volume, seeking, map
hover and station-only text do not qualify. This measures app playback progress;
it cannot determine whether a person actually heard an output device.

Keep listening history can be turned off. Clear recent removes history and preserves
likes. Remove song removes both its like and history; Undo is available for ten
seconds unless a later sync/edit supersedes it. Exports contain only song-library
data. Imports add positive entries and never apply another library's deletion or
settings counters. Limits are 500 likes, 200 recent songs, 1,000 records including
tombstones and 512,000 serialized client bytes. Capacity errors retain saved data.

Signed-out songs stay on this device. Signed-in songs use the existing private
account-sync service. Add local songs explicitly adds this device's guest songs to
the current account; signing in does not adopt songs automatically. Song-only sync
updates the feed without reloading the player. A first-time signed-in library waits
for a successful sync baseline before allowing edits. Known libraries support
offline changes and subsequent conflict resolution.

Local IndexedDB and independent localStorage backup copies are namespaced by account.
Every transaction verifies both the tab identity/version and the authoritative active
account. This prevents stale callbacks from writing into another account. Local song
storage is not encrypted; use separate OS accounts on shared computers. Backups are
integrity checked, not cryptographically authenticated. Removal/clear overwrites old
backup copies so recovery cannot restore removed private records. Backup
publication is serialized with primary writes across tabs, and destructive commits
persist a privacy-generation floor that rejects older backups after an interrupted write.
Browser storage
clearing or uninstall can remove unsynced data: export songs before doing either.
Malformed data is not silently reset; future schemas fail closed and require an update.

## Merge and retry behavior

Identity is SHA-256 of NFKC-normalized, lowercased artist plus title. There is no fuzzy
identity merge. Per-field logical versions preserve like/unlike intent; removal wins
concurrent conflicts. A logical history epoch fences old offline observations after
Clear recent, independently of wall-clock skew. Display dates do not authorize writes.
Three-way merges use the last revision baseline. Whole-document remote tombstones
are retained. Bounded playback-save retries carry owner and history-epoch fences,
with three attempts, a five-second cooldown and explicit focus/online retry triggers.

The existing Supabase document table gains only the bounded `songs` key (one MiB).
Forced RLS, owner SELECT, authenticated CAS RPC, revision checks, tombstones and
anonymous-write denial remain in place. Desktop IPC adds the same bounded key;
tokens remain in the existing main-process encrypted vault.

## Build, validation and rollback

Use the locked npm dependencies. After changing the release version run:

```powershell
node scripts/version-site-modules.mjs
node scripts/fingerprint-runtime.mjs
npm run release:manifest
npm run verify
npm run test:e2e -- --workers=3
npm run test:rendered
npm run test:desktop-renderer
npm run test:desktop-auth
```

Run the rendered matrix separately from the full browser suite on this workstation.
Mutable module/style URLs carry the package version so an older service worker cannot
satisfy a new module import from a differently versioned cached module. They retain
short-lived revalidation headers. The worker precaches the complete new graph before
activation; the hashed runtime retains its content-derived filename.

Test the new SQL migration in local/CI Supabase before applying it to the existing
project. Never create a paid branch to qualify this feature without cost approval.
For rollback deploy the previous release's exact web artifact or reinstall its desktop
package. Leave the additive `songs` allowance and private rows in place; older clients
ignore them. Do not delete song rows or backups during rollback. New song records
are separately namespaced and are not added to the older client's root-record copy
list, preserving account boundaries when downgrading.

Free services retain their normal availability limits. Broadcast metadata may be
missing, delayed or incorrect; catalog/search links do not guarantee a matching song.
