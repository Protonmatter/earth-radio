# Passport web qualification — 0.35.0

Baseline: main `6c26e08602daee5976f6eab6908a647f42877861`. This source introduces
Listening Passport. Published desktop downloads remain v0.34.1 until the approved
Passport → Media Session → sharing → installation sequence completes. No existing
release, tag, profile, provider, SMTP setting or vault was replaced.

The candidate identity is **0.35.0**, runtime **index-9e67ecda.js**, worker
**earth-radio-shell-v78-listening-passport**. The release manifest binds the source
files; staged/index/committed byte hashes are checked at publication. A local pass
does not establish hosted CI, database application or served production acceptance.

## Local evidence

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
installed and claimed **v0.35.0/v78**. Before displaying Passport, the new client
reconciled the prior clear, verified the primary/privacy floor, removed both old
mirror copies and sanitized baseline plaintext. Favorite and 43% volume survived;
the old cache was removed and playback did not start automatically.

All seven small Passport dependencies were cached. The exercised cache had 89
entries and 4,760,099 response-body bytes, including geography already requested by
the map. Offline reload, Passport-only file import and another offline reload
passed with no uncaught error. Large map layers remain outside installation
precache. This is installed-worker desktop-browser evidence, not physical iPhone
Home Screen installation or lock-screen audio acceptance.

## Hosted gates and boundaries

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

## Rollback

Revert the complete feature deployment and advance the worker generation for a
forward correction. Keep the additive private key and existing Passport rows;
do not drop data, lower epochs, replay old mirrors or replace tags/assets. Existing
clients ignore the fifth document and their history clears remain authoritative.
See [Passport behavior/security](PASSPORT.md) and the
[implementation plan](superpowers/plans/2026-11-12-listening-passport.md).
