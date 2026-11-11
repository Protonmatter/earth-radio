# 0.34.0 place-first qualification

ER-05 web 0.34.0 is delivered through PR #48/main `644e19f289fe2b92bf2e4dad118144083a39d4a5`.
Ten head/main checks and 330 hosted browser cases without flaky results pass.
Actual production 106/106/19 file hashes/headers, 15 routes, four account-enabled
Chromium/WebKit contexts and installed-worker/offline checks pass. The merged
tree equals reviewed/corrected `418dfd2` and 435 Git-object hashes verify.
Desktop downloads remain immutable 0.32.2. Six 0.34 candidates match 128 app files
and production metadata, but live data qualification holds publication: Dublin
has 3 root programs versus 30 in the Ireland shard. Correct the producer cutoff
and requalify new source/packages before publishing; no 0.34 tag/release exists.

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
of both new facts modules. Exact-head CI, hosted previews and production readback
also pass. Final desktop artifacts/downloads remain pending the directory fix.

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
