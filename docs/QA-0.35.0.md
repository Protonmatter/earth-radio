# Passport web qualification — 0.35.0

Baseline: main `6c26e08602daee5976f6eab6908a647f42877861`. This source introduces
Listening Passport. Published desktop downloads remain v0.34.1 until the approved
Passport → Media Session → sharing → installation sequence completes. No existing
release, tag, profile, provider, SMTP setting or vault was replaced.

The candidate identity is **0.35.0**, runtime **index-fb2362b3.js**, worker
**earth-radio-shell-v79-passport-privacy**. The release manifest binds the source
files; staged/index/committed byte hashes are checked at publication. A local pass
does not establish hosted CI, database application or served production acceptance.

## Local evidence before review correction

The table records head `9bc593c` (v78). It is retained as dated evidence; the
privacy correction below requires a fresh complete verification and CI run.

## Recorded baseline checks

| Gate | Observed result |
| --- | --- |
| Repository verifier | 733 passed, three existing Windows skips; lint/syntax, metadata/proxy smoke, staged app and website validation pass |
| Complete browser suite | 396 passed with two workers and zero retries, including Chromium and WebKit; no failed, flaky or skipped case |
| Responsive rendered matrix | 42 contexts complete with no recorded error; phone/desktop, safe areas, zoom, locales and controls retained |
| Native Windows ARM | Actual sandbox/preload/IPC, PKCE loopback, token-free renderer, Passport upload/download without document reload, OS-encrypted account restart and logout/normal-quit lifecycle pass with synthetic provider HTTP |
| Owned renderer boundary | Real Electron renderer is accepted only on its own per-launch capability route; missing Origin and raw unauthenticated client remain rejected |
| Place replay | Identical frozen public input: 6,166,295 bytes, SHA-256 `3bcad47c64438e582a6db644942f2739e162a62d90c72281423e1f7ed081d9b6`; all 9,400 program components and eleven city minimums unchanged. Current model-file hashes refreshed; old acquisition/generation metadata preserved |
| Measured observation | Real elapsed-time silent WAV with pause and concurrent song updates earns a place only after the following continuous minute; pure synthetic clocks separately pin 59,999/60,000 ms |
| Privacy and storage | Real IDB account/clear/off-on/open/backup races, old-client clear, baseline plaintext removal, corruption, future schema, quota and missing-primary semantics pass |
| UI and atlas | Six languages, Paper/Night, RTL and 320px controls pass. Computed country colors survive theme changes and clear synchronously on privacy/owner transitions; no additional heavy geography request |
| Transfers | Existing sanitizers, durable atomic legacy import, old files above the separate song limit, Passport-only/additive files, foreign clear counters, held File/owner transitions, quota rollback and hostile city-name text pass. Partial import/export is explicit; damaged data is not reset automatically |

The country-code sidecar is **2,793 bytes**. Generation checks both pinned Natural
Earth country sources, old map-asset digests and every serialized polygon. It uses
`ISO_A2_EH`, then `ISO_A2`; unidentified polygons stay blank. It does not use postal
abbreviations or centroid guesses. All four large map modules, geometry, labels,
hashes and cache URLs remain unchanged. See [identifier provenance](provenance/map-country-identifiers.json).

## Actual worker upgrade

A new isolated Chromium context first ran the frozen, previously delivered
**v0.34.1/v77** app at one loopback origin. It saved a fixture favorite and 43% volume.
A synthetic Passport was seeded into that profile; the actual old client's Clear
button advanced only song history from epoch 0 to 1, leaving the unknown Passport
at epoch 0. This establishes the old-client trigger rather than substituting a new
client implementation.

The server then switched to this candidate at the same origin. The actual worker
installed and claimed **v0.35.0/v78** in the original head9bc test. Before displaying Passport, the new client
reconciled the prior clear, verified the primary/privacy floor, removed both old
mirror copies and sanitized baseline plaintext. Favorite and 43% volume survived;
the old cache was removed and playback did not start automatically.

All seven small Passport dependencies were cached. The exercised cache had 89
entries and 4,760,099 response-body bytes, including geography already requested by
the map. Offline reload, Passport-only file import and another offline reload
passed with no uncaught error. Large map layers remain outside installation
precache. This is installed-worker desktop-browser evidence, not physical iPhone
Home Screen installation or lock-screen audio acceptance.

## Review correction and CI diagnosis

Draft [PR #53](https://github.com/Protonmatter/earth-radio/pull/53) was pushed at
`9bc593c7c188292cf501aa8f4fa1a49d6ae35bcc`. CI43170148717/Supabase43170148724
passed both verify platforms, Windows x64/Mac ARM/Mac Intel native tests, both
Pages checks,45 pgTAP assertions and all3 GoTrue/PKCE/REST/RLS tests. Browser CI
passed394 and failed2 Arabic WebKit cases: Node's ICU formatted Latin2 while
WebKit's CLDR formatted Arabic-Indic٢. The product representation was correct.
The corrected expectation accepts only the exact legitimate locale counts,
without deriving browser output from Node's independent Intl implementation.

One fresh whole-feature review found3 P2 privacy races and no P0/P1. A single
correction pass addresses each with real IndexedDB/native chooser regression tests:

- Obsolete-backup cleanup now returns a primary/policy match separately from mirror
  quota. A declined fence retries the authoritative read before any read/export/sync
  consumer receives data; valid primary reads still survive mirror quota.
- Both choosers capture an owner/history/settings ticket synchronously before
  opening, preserving Safari user activation. One-use factory-local tickets are
  retired on cancel/finish. The original policy is checked before/after File.text
  and within the same durable legacy write transaction, before either import part.
- Sync-baseline reconciliation runs independently of a live primary, including
  a valid deletion tombstone. It removes older visit/hash plaintext while retaining
  the CAS revision, dirty sentinel and primary tombstone/generation.

Initial tests reproduced stale reads/off policies, tombstone baseline plaintext,
and all4 pre-picker clear/off-on imports succeeding. Corrected focused run passed
65 browser cases and18 transfer unit cases. One clear fixture initially reused the
same clear timestamp and was corrected to trigger an actual second clear.
Corrected v79 local acceptance: full verifier738passed/three existing Windows skips,
complete410browser cases with two workers and zero retries/failures/flaky/skips,
42rendered contexts and native ARM auth/renderer/encrypted restart all pass.
Actual v77→v79 and frozen v78→v79 same-origin worker upgrades preserve the favorite
and43percent volume, sanitize history/recovery/baseline state, remove the old cache,
and pass offline Passport import plus reload without autoplay/errors. Each exercised
cache has89entries/4,766,365 response-body bytes. Frozen public replay remains
identical9400programs/all11city minima. The same reviewer independently confirmed
all3 original P2 findings resolved, including quota and tombstone controls, and
found no residual in those paths. The reviewed source hash receipt is retained.
Fresh exact-head CI/preview, hosted apply and production acceptance remain open.

The reviewer reasonably excluded physical lock-screen/background/audio/IME and
assistive-technology acceptance, fresh live providers/original-profile upgrades,
public signing/notarization, hosted apply/served checks, later Media Session/share/
install/data/performance work and professional linguistic certification. Those
boundaries are accepted; parent-owned hosted delivery remains required and later
roadmap work remains active. Existing free signing decisions are preserved.

## Catalog control readiness correction

The first complete corrected-source browser run finished407passed/1failed with
zero retries. The failure was More filters at390px in WebKit: the trigger was
enabled before asynchronous catalog initialization assigned the sidebar owner.
The click therefore called an initialized handler with no sidebar to open.
A held-directory regression reproduced premature availability in both engines.
The static button now starts disabled and the existing filter initializer enables
it only after its sidebar, data, delegates and controls are ready. The recovered
TypeScript mirrors that single runtime correction; no search/ranking/collection
semantics changed. Keep the failed full-run log and both RED traces as evidence.
The final full qualification above includes this correction. The reviewed Passport
privacy paths retain their bytes apart from the separately audited runtime hunk.

## Qualification workload experiment

The four-worker full run finished408passed/2failed without retries. The20,000+
catalog case hit its unchanged20-second initial-list assertion (0stations), and a
WebKit setup hit local `route.fetch: ECONNRESET` for config.js before application
assertions. The directory fixture responses in the first trace completed in about
67ms and12ms; no page error was recorded. The earlier two-worker run passed both
cases (the large catalog took20.7s total). With unchanged code, an isolated
one-worker run passed all3 relevant engine cases; the complete large-catalog test
took15.1s and the WebKit filter case3.4s. This supports a qualification-workload/
local-transport explanation, without proving mobile performance. No assertion,
timeout, product code or test retry was weakened. Failed logs/traces are retained.
The final entire two-worker run passed410cases with zero retries.

## Hosted gates and boundaries at candidate publication

The prepared migration is
`supabase/migrations/20261112033456_listening_passport.sql`. It admits the fifth
bounded document while retaining the prior four limits, forced RLS, owner SELECT,
`auth.uid()`, empty privileged search path, authenticated-only RPC and CAS semantics.
The live structure/advisors were inspected read-only before qualification.

There is no local Docker stack. The existing isolated Supabase CI must execute all
45 pgTAP assertions and GoTrue REST/PKCE tests, including Passport ownership, CAS,
UTF-8 limits and tombstones. Native CI must pass on Windows/macOS. These results,
one fresh whole-feature review, exact-head checks and actual served preview/main
acceptance are delivery gates; this local record does not promote them to passes.
Hosted application and post-apply checks follow only after the isolated tests pass.

Existing advisories are the intentionally authenticated SECURITY DEFINER sync RPC
and disabled leaked-password protection. No auth/provider configuration changed.
Live external Google/GitHub/email qualification remains separate from synthetic
native HTTP and isolated GoTrue tests. Original-profile upgrades, physical iPhone/
Android/Mac/Intel-Windows installation, public Windows signing trust, Apple
notarization, OS IME and audible fidelity are not established by these tests.

## Final delivery addendum

Passport web 0.35 was accepted November 12, 2026 at 08:46:49 UTC. PR #53 head
`a30d2444682cb4191d6c7a986a20fb4f02f4bf90` merged as
`7e5e33b0ccc52c9cff016ae53c28ff5196a9be09`; their source trees are identical.
The [delivery receipt](provenance/web-0.35.0.json) records ten head/main checks and
410 browser cases per source without failures, flaky cases, skips or retries.
Local verifier: 738 passed, three existing Windows skips; 472 canonical hashes,
42 rendered contexts, native platforms and actual worker/offline upgrades pass.

After isolated 45 pgTAP/3 Auth tests, the exact 3,449-byte SQL with SHA-256
`77a38c6afe91fb23d98f81b52de88d5fa07e0700d4520b981b24aa9c92fd8ba3`
was applied as remote journal `20261112081804/listening_passport`. The local CLI
filename remains `20261112033456_listening_passport.sql`; no history repair was
attempted. Catalog comparison proves only the Passport key/262,144-byte admission
changed. Other limits/constraints, forced RLS, owner SELECT, ACL, empty privileged
search path and CAS remain; security advisories are unchanged.

Production: 113 app files per app origin and 19 website files match all bytes and
cache/security headers. Fifteen routes, four live UI contexts, explicit guest Passport
import/off/on/clear, visible account controls, muted Classic Vinyl start and offline
checks pass. The bounded canary completed three cycles/nine HTTP 200 checks, 70–177 ms in this
observation. Original profiles/providers/SMTP/vault and prior releases are unchanged.

Scheduled directory run 43182769798 rejected overlapping upstream pages before
publication and retained the last good generation. The producer code and previous
five hourly successes were inspected. One controlled same-source run 43183637001
build/deploy passed all guards and 454 atomic artifacts. Its 08:31:53.445 generation
has 10,000 identities/9,423 logical stations/9,980 streams. Actual catalog 6,181,670 bytes
and legacy 5,841,769 bytes match both public SHA descriptors and all 11 city minimums.
An initially older cached representation converged through ordinary refresh;
no purge or guard weakening occurred. Failed history and narrowly verified recovery
remain explicit in the acceptance receipt. Spaces sequence 49 records Step 263.

Published desktops remain v0.34.1 until the remaining phase4 features are ready.
All physical, live-provider, signing/notarization and fidelity boundaries above
remain unchanged; this addendum does not promote them to passes.

## Rollback

Revert the complete feature deployment and advance the worker generation for a
forward correction. Keep the additive private key and existing Passport rows;
do not drop data, lower epochs, replay old mirrors or replace tags/assets. Existing
clients ignore the fifth document and their history clears remain authoritative.
See [Passport behavior/security](PASSPORT.md) and the
[implementation plan](superpowers/plans/2026-11-12-listening-passport.md).
