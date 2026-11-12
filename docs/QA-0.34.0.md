# 0.34.0 place-first qualification

ER-05 initially delivered web presentation through PR48/main644e19f. PR49 then
corrected a reproduced root-cutoff coverage gap and merged as release source
`9fefbd0a1b295a79857a9fafd7a127b399061536`. All ten head/main gates pass, each hosted
browser log reports 332 passes without flaky results, and actual production
matches 106/106/19 files with headers, 15 routes, four account-enabled UI contexts
and an installed-worker/offline check. The reviewed and merged Git trees match;
441 committed source hashes verify.

[v0.34.0 is published](https://github.com/Protonmatter/earth-radio/releases/tag/v0.34.0)
with six source-matched desktop builds and seven support assets. All thirteen
draft and anonymous public downloads pass full size/SHA-256 checks. Both public
directory formats/origins match the current manifest and all eleven city minima;
the actual native loopback reader also passes with one root read. Both Windows
guest profiles retain favorite/volume and Continue without autoplay after two
normal quit cycles. Native Mac and Windows package/signature scopes and remaining
physical/live-provider limits are in the [release record](RELEASE-0.34.0.md) and
[public receipt](provenance/release-0.34.0.json). Earlier candidates remain intact.

The following sections retain initial ER-05 source-stage evidence; the producer
correction and final desktop acceptance above supersede its earlier release hold.

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
also pass. The subsequent producer correction and final desktop acceptance are
recorded above; no original account, provider or vault configuration changed.

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
