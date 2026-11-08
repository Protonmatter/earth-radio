# Earth Radio 0.29.0 qualification

The [release record](RELEASE-0.29.0.md) defines publication gates. Song-library behavior,
limits, privacy controls and rollback are in [SONG_LIBRARY.md](SONG_LIBRARY.md).

The local suite covers parsing, safe exact/search links, Unicode identity, dwell and
pause/seek/background playback, logical conflict resolution, history epochs, bounded
capacity, exports/imports and backup integrity. Browser tests exercise real IndexedDB,
account fences, explicit guest import, disabled writes before initial sync, removal,
Undo, reload, privacy floors, delayed transaction-completion ordering and interrupted
backup publication. Maximum-length multilingual credits fit at 320×568. The separate
42-scenario rendered matrix preserves layout, safe areas, zoom and locale behavior.

Station regressions retain directory loading, offscreen search, worldwide area search,
country expansion, no-result recovery, retries, cached directories, favorites, Similar,
HLS and navigation. Phone reload/resume selects the displayed station and publishes
its canonical identity. The existing sandbox/vault/restart/logout checks run on native
Windows and hosted macOS. Supabase CI runs the SQL ownership/CAS/size/tombstone suite
and local GoTrue/PostgREST/Mailpit workflow; these use isolated synthetic users.

Live qualification is separate from fixtures. Verify a real structured broadcast,
like/history persistence, current account song sync without reload, production bytes,
headers and active service worker. Keep original account identity and grants unchanged.
Use an isolated native profile and pause guest playback before signing in so test
volume is not uploaded over the owner's established preference. Final live findings
and source/deployment identities belong in release provenance and Spaces.

Desktop release qualification compares every packaged source and payload file with
the exact final main commit, verifies signatures with their stated trust limits,
architecture, bounded startup, normal portable quit and all draft/public asset hashes.
It does not establish trusted publisher signing, Apple notarization, physical Mac
installation/upgrade, every existing-profile migration or installed iOS/iPadOS acceptance.
Broadcast data can be missing, delayed or inaccurate; silent fixtures do not qualify
audio fidelity or human audibility. A controlled completion schedule models the storage
publication gap; it is not an actual OS crash or physical power-loss test.
