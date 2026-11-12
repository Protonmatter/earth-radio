# Listening Passport design

ER-06 from the approved Daily-Return roadmap. Base:
`6c26e08602daee5976f6eab6908a647f42877861`. The v0.34.1 release and PR52 metadata
delivery are complete. This is the next feature, not a claim that the whole
roadmap is delivered. User delegated design/implementation and opted out of
questions except new cost. Choices below are engineering decisions, not a claim
that the user approved a design document they have not read.

## Intent and approach

Show countries and confirmed cities whose radio the listener has played for a
continuous minute. Make progress visible in Library and on the atlas. No streaks,
location tracking, notifications, analytics, new service or new runtime dependency.
Do not change station selection, stream recovery, song identity or existing accounts.

Considered approaches:

- Rebuild from Recent/likes: cannot establish listening duration; rejected.
- Add fields to song-library v1: its normalization drops unknown fields on old
  clients; rejected because updates could silently lose Passport data.
- A separate bounded document using existing account sync: selected. It needs
  explicit owner/history fencing and additive fifth-key admission, and preserves
  the song format and old-client behavior.

Use the existing verified station/place model. Country credit needs a recognized
reported country code. City credit requires `stationPlace(...).confidence ===
'city'`; centroids, nearby guesses and name-only inference never earn a city.
Initially the corroborated city vocabulary is the existing curated model; ER-16
will expand it. Retain valid unknown Natural Earth city IDs in stored/imported
documents for forward compatibility, but never invent a pin or coordinates.

## Measured continuous playback

`ContinuousPassportSession` is pure, taking explicit monotonic time, media time,
UTC day, owner/version, policy/epoch, program/source and place. Threshold is
60,000ms. A sample can add only `min(media delta, monotonic wall delta)`; fast
seek/time jumps cannot earn time. Accept at most a 5,000ms sample gap and a media
delta at most wall delta + 500ms. Non-finite/negative values fail closed.

Pause, waiting/stall, seeking, ended/error/emptied/loadstart, zero volume/mute,
insufficient media readiness, owner/version, program/source or policy/epoch change
reset the run. No autoplay, hover, selection, metadata lookup or like earns time.
Use advancing media samples, not merely a running timer. Emit at most one place
observation per continuous run and UTC day. A failed save never transfers credit
to a different owner/epoch; bounded retries retain both fences.

A gap over five seconds resets rather than inferring uninterrupted background
audio from two samples. This can undercount when a browser suspends JavaScript;
it does not prove a physical speaker was heard. Document this boundary and keep
physical iPhone/background qualification separate. Changing this conservative
rule later requires evidence and tests.

## Document and privacy contract

Passport v1 is `{version:1, historyEpoch, historyClearedAt, countries, cities}`.
Countries map a recognized code to `{firstDay,lastDay}`. Cities map a bounded
`ne-<positive integer>` ID to `{countrycode,name,firstDay,lastDay}`. Days are UTC
epoch days, not fine-grained sessions. Do not persist stream URLs, tracks,
coordinates, timers, user location or session credentials in Passport.

Limits: 300 countries, 1,000 cities and 128,000 serialized client UTF-8 bytes.
Server/native admission is 262,144 bytes to allow JSON representation overhead.
Capacity failure preserves existing data. Reject malformed/future schemas;
retain/quarantine damaged primary data rather than silently resetting it.
Envelopes carry namespace, generation, policyEpoch, timestamp, payload and an
integrity checksum. The checksum is not authentication or encryption.

Every operation checks the tab owner/readiness/version and authoritative
`account:active` inside the SAME earthRadio/kv transaction that reads song policy
and reads/writes Passport. Signed-in first use waits for sync baseline. Guest
data is not adopted at sign-in; adding it requires an explicit control.

History off blocks recording/import and hides Passport with a plain explanation.
Existing visits remain, consistent with the song library's off toggle. Turning
history back on does not backfill missing duration. Clear history advances the
existing logical song epoch and clears Passport, including recoverable copies.
Current-client clear must atomically persist the Passport clear/floor with the
song clear. Old-client clears are reconciled before any read, record, merge,
sync, import, export or backup recovery. Stale pending writes, cloud values,
baselines and backups cannot restore a prior epoch. A Passport epoch ahead of
song policy blocks disclosure/writes until policy catches up; never lower it or
erase song history to accommodate Passport.

Backup publication is serialized against current primary generation and policy
inside an owner-fenced transaction. Destructive commits persist a privacy floor
before mirror cleanup, so a crash cannot revive an older copy. Privacy/account
transitions clear the visible view and map shade before asynchronous refresh.

## Sync and compatibility

Append `passport` after `songs` in `sync-core.js`. Keep CAS revisions, tombstones,
three-way merge, bounded retries, active-user checks and current first-sync rules.
Merge only entries in the highest applicable history epoch. Explicit imports add
positive entries into the current local epoch; foreign deletion/settings/epoch
counters are not applied. Missing/corrupt local storage must not become an
accidental remote deletion. Future-schema failures require an update.

Add native admission in `electron/auth-manager.mjs` and the existing SQL RPC/key
constraint only. Preserve all four prior keys, limits, forced RLS, owner SELECT,
auth.uid checks, empty privileged search_path, grants/revocations and revision
semantics. No new table, identity/provider setting or secret. Migration filename
was created by CLI2.115.0: `20261112033456_listening_passport.sql`.

The official [CLI v3 changelog](https://supabase.com/changelog/supabase-cli-v3)
changes command targeting/confirmation; keep the repository's tested v2 pin.
Consulted [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).
No local Docker exists. Database/GoTrue qualification uses the existing isolated
CI stack before a reviewed bounded hosted migration. Do not upgrade infrastructure.

## UI, map and transfer

Add Passport to existing Library section controls, preserving all prior sections.
Use approved Paper/Night tokens, all six locales, RTL, keyboard focus, 44px targets
and 320px layout. Wrap section controls if needed; no page-wide overflow. Show
country/city totals and a country list with its confirmed cities, plus clear empty,
history-off, loading/sync, capacity and recovery states. No fabricated listening
records or forced playback. Reuse existing history control and explicit Clear.

Expose a read-only clone of current station/program context from the existing
discovery adapter; do not infer it from UI copy or Recent. Sample real audio
state. Country shading composes with existing basemap themes and labels, clears
on privacy/owner changes, and never forces heavy map data to load early.

Provide Passport export/import and include it as an additive property in the
general Settings schema1 transfer. Keep old valid formats, favorite/recent/pref
sanitization and the separate song transfer. Use a small supported async transfer
bridge in the authoritative runtime, not Blob/IndexedDB monkeypatching. Capture
and recheck owner/version before asynchronous work. Passport-only imports have an
explicit path; partial legacy/add-on failure must not claim complete success.
Never export credentials or another profile. Imports cannot apply a foreign
clear epoch or resurrect data automatically.

## Verification, delivery and rollback

RED/GREEN pure timing/schema/merge tests; real IndexedDB owner/clear/backup races;
old-client clear and two-client CAS; boundary/hostile import/export cases; all six
locales/RTL/Paper/Night and map shade; complete search/playback/auth/browser/native
regressions. Isolated pgTAP/GoTrue tests prove five-key admission, prior keys,
cross-user and anon denial, CAS, tombstones and size limits. Keep provider/physical
and audible-fidelity evidence distinct from fixtures.

Inline implementation, one fresh whole-feature review at the end. If a draft push
is necessary for unavailable local database tests, label that gate pending and do
not merge/deploy before it passes. Strict exact-head/main and actual served gates
remain required. Phase4 desktop publication follows its approved feature sequence;
do not relabel the existing v0.34.1 binaries as new feature builds.

Rollback disables/reverts the complete feature deployment while retaining the
additive private key/schema and user data. Do not drop Passport rows, revert
constraints over populated data, rotate credentials, replace tags or clear user
profiles as a rollback. Advance the worker identity for a forward correction.
