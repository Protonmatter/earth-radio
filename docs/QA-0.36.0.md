# Media Session qualification — 0.36.0

Base: accepted Passport main `7e5e33b0ccc52c9cff016ae53c28ff5196a9be09`.
Candidate identity: **0.36.0**, runtime **index-b6b29555.js**, worker
**earth-radio-shell-v80-media-session**. Published desktop downloads remain
v0.34.1 until the approved Media Session → sharing → installation sequence ends.

The feature adds current-song/station Media Session metadata, truthful local PNG
artwork and an owned Stop action. The existing player, filtered-list navigation,
successful-selection gates, explicit station/World Scan intent and history/sync
owners are preserved. No dependency, database, provider, SMTP or vault change is
required. The four large map files and their cache URLs remain unchanged.

## Implementation evidence

On the intermediate 0.35 release URLs, two actual-browser RED tests reproduced the
old station/raw-country metadata while the promoted song was visible, and the
missing Stop action. The corrected implementation passed eight native-API browser
cases, 28 transport/metadata cases and 33 privacy/account cases, with overlapping
new cases included. The real-time Passport minute case passed after a pause and
concurrent song updates. All 39 pure/artwork/controller cases pass, as do lint,
syntax and repository safety checks.

The guarded runtime integration changes 13 owned boundaries. Parser scope checks
distinguish the legacy private builder from retained Leaflet functions with the
same minified name. Initial uniqueness guards stopped in memory before any file
write. The old private station-only builder is replaced by maintained modules;
the exported reference metadata API remains available. Stop uses the pause/token/
intent path, explicit stopped state, source/HLS/timer cleanup and a played-flag
reset. Late stopped events cannot change idle state, and explicit replay works.

The artwork suite covers trusted origins, credential/referrer omission, redirects,
content/byte/pixel/edge/output limits, four-entry cache, deadline, canceled and
non-cooperating decoders, two-job concurrency and disposal. Native media receives
only bounded local PNGs or the first-party brand fallback. Browser tests verify
actual 96/256/512 pixel dimensions. An initial test incorrectly used `fetch()` for
a data URL, which strong `connect-src` correctly rejected; the test now uses image
decoding under `img-src`. No production CSP was weakened; failed evidence is kept.

The 0.36 identity update changes coherent release URLs and package versions;
the lockfile dependency graph is unchanged. Three small modules are added to the
offline shell. The dependency RED test failed before insertion; all 24 worker
tests pass afterward. Current-source full qualification remains pending.

Four additional Chromium/Windows-WebKit compatibility cases pass using the actual
compiled player and bitmap/canvas pipeline. Windows WebKit in this run exposes no
Media Session API; its ordinary playback, advancing clock, pause and resume still
pass. The loopback-only test server supplies deterministic PCM with validated
GET/HEAD and byte-range behavior because that engine's media process can bypass
Playwright request interception. Nine website/server tests pass. No test endpoint
is included in the public build.

The isolated Windows ARM64 Electron 43.8.7 Media Session smoke passes with the
actual native API, sandboxed renderer, local PCM and a controlled cover. It checks
registration of all five actions, fields, real PNG sizes, pause, stop, navigation
and explicit replay without autoplay. That smoke uses an audio adapter; the
browser tests separately exercise the full compiled player. Native smoke is now
part of the existing three-platform desktop-auth CI command.

## Required delivery gates

Current-source local checks on November 12, 2026:

| Check | Observed result |
| --- | --- |
| `npm run verify` | 778 passed, three existing Windows skips, zero failures; 488 canonical file hashes |
| `npm audit --audit-level=moderate` | Zero advisories |
| Complete Chromium/WebKit browser suite | 422 passed in 9.9 minutes; two workers, zero retries/failures/flaky cases/skips |
| Rendered Electron matrix | 42 contexts, complete, zero errors and no skip on the qualified rerun |
| Native Windows ARM64 | Sandbox/owned-frame IPC, PKCE, encrypted restart, Passport-only sync, logout, normal quit, media controls and owned renderer pass |
| Frozen place replay | Identical 6,166,295-byte input and all 9,400 program semantics; all eleven city minimums remain met |
| Actual v79→v80 worker upgrade | Favorite and 43% volume retained; no autoplay; history privacy floor, both mirrors and sync baseline retained; old cache removed |
| Offline after upgrade | Reload, Passport import and reload pass; ten required shell dependencies present; 92 cache entries and 4,781,703 body bytes |

The initial rendered command reported a dependency-path skip. The ignored
worktree dependency junction was restored to the existing exact locked runtime;
the real 42-context rerun passed. Both records are retained.

Remaining gates:

- Canonical index/commit blob verification.
- One fresh source review; every finding and declined scope ruled on explicitly.
- All exact-head checks and actual preview artifact/header/route/UI/offline checks.
- Expected-head merge, final-main checks/logs, production readback and bounded canary.

The app-facing metadata/native tests use controlled providers and media. Native
callback invocation is synthetic OS input. This does not establish new live
provider sign-in, original-profile upgrade, physical installation, OS media-key/
lock-screen behavior, assistive-technology certification or audible fidelity.
Accepted local Windows signing and unnotarized Mac distribution remain unchanged.

## Previous delivery and rollback

Passport v0.35 was accepted at 08:46:49 UTC on November 12, 2026, with all ten
head/main checks, 410 clean browser cases per source, verified hosted key admission,
served production and a healthy canary. Its [receipt](provenance/web-0.35.0.json)
and [qualification addendum](QA-0.35.0.md#final-delivery-addendum) retain exact source,
SQL, publication recovery and qualification boundaries.

Rollback restores that accepted feature baseline with a fresh worker generation;
do not drop account/Passport data, lower epochs, rotate credentials or replace
published release assets. Physical-device and provider evidence remains dated.
