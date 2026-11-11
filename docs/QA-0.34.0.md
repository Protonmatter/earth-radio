# 0.34.0 place-first qualification

This is the ER-05 candidate, based on delivered 0.33.1. It is not yet published.
Desktop downloads remain the immutable 0.32.2 release until the final phase3
builds and their downloads are qualified separately.

Rows, player facts and tooltips now lead with corroborated place and local time.
Country fallback does not invent a city or clock. Technical stream choices and
facts live in Details; original directory status nodes live in Settings.
The original audio, catalog, UUID aliases, collections and account/sync owners
are retained. No dependency, service, telemetry or credential setting is added.

Observed failures before correction include country facts entering the song
lookup, a minute tick replacing a playback failure, a late stream probe clearing
or replacing live raw input, a long genre clipping the clock at 320px, and the
right-to-left Details close button overlapping its eyebrow. Focused tests now
pass for each. Closing an automatic account-error dialog also returns to a
visible navigation target. Six locale catalogs include every new UI string.

The retained frozen directory produces identical coverage after release URL
changes: 9,400 program components and eleven qualified cities. The native seed
reads one root and returns 3,016 records; every curated city retains at least
five native programs. This is evidence from the retained input, not a claim
that every live stream or new directory publication is reachable.

Local gates pass: the final `npm run verify` reports 665 passing tests, three
existing Windows skips and 435 deterministic hashes, with lint/syntax and both
staged artifacts validated. All 330 browser cases pass at three workers without
retries. The 42-scenario rendered matrix and Windows ARM64 sandbox, synthetic
provider PKCE/sync, encrypted restart, logout persistence and normal-quit checks
pass in isolated profiles. Twenty-four worker checks include offline handling
of both new facts modules. Exact-head CI, hosted previews,
production readback and new desktop artifacts remain pending.

The fresh whole-branch review found one P2 issue and no P0/P1 issues: a directory
refresh replaced an open Details stream selector and lost its keyboard focus.
The new regression failed in Chromium and WebKit. The renderer now restores
focus only if the replaced selector owned it, with Play as the fallback when no
selector remains. Six focused cases pass, preserving the chosen UUID, no-autoplay
state and focus on Stream, Close or Play. The full post-correction verifier,
330 browser cases without retries, 42-scenario rendered matrix and isolated
native sandbox/authentication/restart lifecycle checks pass.
Fresh OAuth/email delivery, physical iPhone/Android, VoiceOver, installed-PWA and
Mac installation/upgrade acceptance remain distinct from automated fixtures.
Existing public-signing/notarization limitations are retained by user choice.

Rollback restores a complete preceding deployment and advances the worker
generation. It requires no user-data clearing, schema migration, account change
or secret rotation. Keep the explicit raw-title marker and facts renderer paired.
