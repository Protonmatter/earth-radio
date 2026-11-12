# Listening passport

Local implementation for the next web release. Production and published desktop
downloads remain v0.34.1 until the full qualification and delivery gates complete.
The database migration in this branch is prepared, not yet applied.

## Using your passport

Open **Library → Listening passport**. A country appears after one continuous
minute of advancing station audio. A city appears only when the shared place
model corroborates both the station's coordinates and its city name. Country
centroids, nearby guesses, browsing, favorites and song likes do not earn places.
Existing Recent and song history cannot establish past duration and are not backfilled.

The list shows countries, confirmed cities and the first/latest UTC listening
dates. Saved countries are shaded on the atlas in Paper and Night. Shading does
not load extra detail layers or move stations. It represents stations you listened
to, not places you physically visited. The existing city model is deliberately
small; broader location coverage is a later roadmap item.

**History settings** opens the existing **Keep listening history** control in
Your music. Turning it off stops recording and hides previous Passport visits;
turning it on reveals saved visits without backfilling the disabled period.
**Clear listening history** clears Passport visits and recently heard songs while
preserving liked songs. If signed in, the clear synchronizes to other devices.
Older clients that only advance the song-history epoch are honored before any
Passport read, merge or recovery.

Without an account, the passport stays on this device. Signing in does not adopt
guest visits automatically. **Add this device's passport** is an explicit positive
merge into the signed-in profile, after its first sync. Disabled/cleared guest
history cannot be imported through that control. Account changes clear the view
and atlas shade immediately while the new profile loads.

**Export passport** creates a Passport-only JSON file. **Import passport** adds its
places without applying foreign deletion counters or history settings. Settings
Export also includes Passport alongside schema 1 favorites, recent stations and
preferences; old exports remain supported. Settings Import accepts either format.
If station data saves but Passport fails, the result says so; it does not claim a
complete import. General files are capped at 32 MiB, retaining the existing 8 MiB
favorites, 1 MiB recents and 64 KiB preferences contracts plus formatted JSON overhead.
The separate song-file limit does not limit general exports.

If Passport cannot be read, Settings Export can still save the legacy station
records after an independent authoritative account check. The file contains
`passportOmitted:true`, and the interface warns that Passport was not included.
It never exports an unreadable payload or silently resets it. If no valid local
recovery copy exists, automatic sync/import stays blocked to protect that data.
Use History settings to clear it explicitly, then import a known Passport export
from another device or an earlier backup. Clearing is confirmed and is not undone
automatically. An unavailable authoritative account check blocks the export.

## What a minute means

The pure sampler consumes actual media time and a monotonic clock. It accumulates
the smaller of advancing media and wall time, in integer microseconds. The
threshold is 60,000 ms. Pause, waiting/stall, seeking, ended/error/load, mute, zero
volume, insufficient readiness, station program/source, account or history-policy
changes reset the run. A media jump greater than the wall interval plus 500 ms
cannot earn credit. A gap above 5,000 ms restarts the observation.

This conservative gap rule can undercount background listening when a browser
suspends JavaScript. Two samples cannot establish continuous output during a long
gap. The feature does not record audio or prove that a physical speaker was heard.
Silent fixture playback, phone-size browser tests and native sandbox tests do not
qualify physical iPhone lock-screen playback, OS IME behavior or audible fidelity.

## Storage, sync and security

- Separate v1 document: logical history epoch/clear time, country date ranges and
  confirmed-city identifiers/names/date ranges. No station URLs, songs, fine-grained
  timers, coordinates, device location or credentials are persisted in Passport.
- Bound to 300 countries, 1,000 cities and 128,000 serialized client UTF-8 bytes.
  Native/SQL admission is 262,144 bytes to allow JSON representation overhead.
- Each IDB transaction verifies tab readiness/version, authoritative `account:active`
  and song privacy policy together. Writes, delayed file reads, recovery and backup
  publication retain their original owner, epoch and settings-version fences.
- History clear writes the empty Passport, generation privacy floor and sanitized
  sync baseline in the same transaction as the song clear. It removes plaintext
  visits from both local recovery mirrors and the sync baseline. A previously
  synced offline account retains its CAS revision, not its old payload/hash.
- Missing primary data is not a cloud-delete instruction. Future schemas and
  Passport epochs ahead of song policy fail closed without erasing either document.
  Capacity or primary quota failures preserve prior data. Mirror failure is reported
  separately from a successful primary commit. Checksums detect corruption; they
  are neither encryption nor authentication. Local browser records are plaintext.
- Passport is the fifth existing synchronization document, processed after songs.
  Positive same-epoch additions converge; higher clear epochs and whole-document
  tombstones prevent stale clients from restoring old visits. Passport-only sync
  updates the current view without reloading the page.
- Prepared migration `20261112033456_listening_passport.sql` admits the extra key
  and its limit. The four prior limits, forced RLS, owner-only reads, `auth.uid()`
  check, empty privileged search path, authenticated-only RPC and revision checks
  remain. It adds no table, role, provider, credential or new service.

The general transfer bridge prepares legacy records with the existing sanitizers,
commits them atomically in an owner-fenced IDB transaction, then updates the runtime
mirror. It never patches Blob or IndexedDB APIs. Only synthetic tests intercept
native callbacks or File reads to exercise races. Unknown fields and credentials
are excluded from export. The older reference TypeScript documents the maintained
bridge; it still does not independently rebuild the recovered runtime.

## Map identifiers and reproducibility

The 2,793-byte `map-country-identifiers.js` sidecar assigns codes to the existing
world/detail country polygons. Its generator verifies both pinned source files,
all map-asset hashes and every serialized polygon against the original curator.
JSON normalizes negative zero; no coordinate tolerance or nearest-centroid match
is introduced. It uses Natural Earth's `ISO_A2_EH`, then `ISO_A2`; unidentified
polygons stay blank. Postal abbreviations are never country aliases.

The four large map files, their geometry, labels, content hashes and cache URLs are
unchanged. A future mismatched asset/count disables its shading rather than using
stale ordinal identities. If country data cannot load, the coastline fallback
remains usable and saved places remain in Library. See [map documentation](MAP_DATA.md) and the
[identifier provenance](provenance/map-country-identifiers.json).

## Validation and release gate

```powershell
npm run verify
node --test tests/passport-core.test.mjs tests/passport-sync.test.mjs tests/passport-map.test.mjs tests/user-transfer.test.mjs
npx playwright test --config tests/e2e/playwright.config.mjs tests/e2e/passport-storage.spec.mjs tests/e2e/passport-ui.spec.mjs tests/e2e/passport.spec.mjs --retries=0
npm run test:desktop-auth
```

The actual-media test runs in real elapsed time with a silent WAV; it includes a
pause and concurrent song-store notifications. Pure synthetic clocks separately
pin the exact 59,999/60,000 ms boundary. UI tests cover all six languages, Paper/Night,
RTL, 320px controls, browser-computed map colors and synchronous privacy clearing.

No local Docker is available. The 45 pgTAP assertions and GoTrue REST/PKCE workflow
must pass in the existing isolated CI stack before the hosted migration, merge or
deployment. Live project structure/advisors have been inspected read-only. Existing
advisories are the intentional authenticated SECURITY DEFINER CAS RPC and disabled
leaked-password protection; no auth setting was changed. One fresh whole-feature
review and exact-head/main/served checks remain required. Desktop publication
follows completion of Passport, Media Session, sharing and installation work.

## Rollback

Revert the complete web feature and advance the service-worker generation for a
forward correction. Preserve the additive database key and all Passport rows;
do not drop records, lower epochs, restore stale backups, replace release tags or
reset profiles. Prior clients continue to ignore the fifth document, and their
song-history clears remain authoritative when a Passport-capable client returns.
Reverting source alone does not restore deleted history; exports are explicit
positive imports. Existing accounts/providers/SMTP/vault and prior releases are
outside the change.
