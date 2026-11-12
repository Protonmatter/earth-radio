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
| `npm run verify` | Observer follow-up: 780 passed, three existing Windows skips, zero failures; 489 canonical file hashes; hermetic-config follow-up tracked below |
| `npm audit --audit-level=moderate` | Zero advisories |
| Original reviewed Chromium/WebKit browser suite | 422 passed in 9.9 minutes; two workers, zero retries/failures/flaky cases/skips; observer follow-up campaigns are recorded below |
| Rendered Electron matrix | 42 contexts, complete, zero errors and no skip on the qualified rerun |
| Native Windows ARM64 | Sandbox/owned-frame IPC, PKCE, encrypted restart, Passport-only sync, logout, normal quit, media controls and owned renderer pass |
| Frozen place replay | Identical 6,166,295-byte input and all 9,400 program semantics; all eleven city minimums remain met |
| Actual v79→v80 worker upgrade | Favorite and 43% volume retained; no autoplay; history privacy floor, both mirrors and sync baseline retained; old cache removed |
| Offline after upgrade | Reload, Passport import and reload pass; ten required shell dependencies present; 92 cache entries and 4,781,703 body bytes |

The initial rendered command reported a dependency-path skip. The ignored
worktree dependency junction was restored to the existing exact locked runtime;
the real 42-context rerun passed. Both records are retained.

## Hosted observer correction

The first PR #54 head, `d3b01c9`, passed nine hosted checks, including all three
native platforms, both verifiers and database/Auth tests. Both macOS candidate
DMGs passed payload/mount/startup qualification. The actual preview passed
116 app/19 website file hashes and headers, ten routes, four live guest journeys,
owned Stop on muted live playback and an offline-shell check.

Its hosted browser run had 421 passes and one persistent Linux-WebKit test failure:
the fixture observed Media Session but had no captured Stop callback. That is
insufficient evidence that the browser rejected Stop. The original test wrapped
one native object instance, which can miss calls through a renewed wrapper.
Two deterministic observer tests reproduced lost registrations before correction
and pass with a shared-prototype observer. The observer preserves the native
receiver, return value and thrown exception, records every attempted action and
captures only successful callbacks. The compatibility test now fails on any
missing attempt and requires a real native exception for an unsupported action.
Play/Pause registration and transport are required where the API is present;
supported Stop still must clear metadata and permit replay. The existing eight
Chromium native-API cases retain their unconditional Stop assertions.

All twelve focused browser cases pass locally after correction. Product runtime,
source/reference player, offline cache graph, map data and installer inputs are
unchanged. The failed hosted run/report/traces are retained; it does not authorize
merge. Full local/browser verification, same-reviewer follow-up and fresh exact-head
CI are required before delivery. Linux's actual registration results must be read
from that new run rather than inferred from the original missing observation.

The first two-worker corrected local matrix had 421 passes and one 20-second
startup assertion timeout in the existing 21,002-record catalog-expansion case.
Its trace shows snapshot/country responses of 200 in about 53/8 ms and no page
error. The unchanged case then passed in isolation: 16.2 seconds for the candidate
and 15.3 seconds for accepted v0.35. Those single flow timings are not a calibrated
performance comparison. The assertion, timeout and workload remain unchanged;
the next complete local campaign uses one worker and no retries, while hosted CI
keeps its normal configuration. Retain the failed local trace and track startup
performance margin with ER-14. No product optimization is claimed in this pass.

Native registration diagnostics are attached to test results and also printed as
small non-sensitive CI log records, because successful HTML reports are not
uploaded. The observer follow-up review found no issue and independently passed
19 focused tests; its reviewed bytes and final diagnostic addition remain bound
to the local qualification receipt.

## Hermetic config transport

The next head, `032c912`, passed all ten GitHub checks, but its browser log had
421 passes and one flaky retry. The failing attempt stopped in 397 ms with
`route.fetch: read ECONNRESET` while obtaining loopback `config.js`, before the
artwork test reached the app. The retry passed; that does not meet the clean-run
acceptance gate. PR #54 remains unmerged and is draft during correction.

The same hosted diagnostic log explicitly records successful registration of all
five actions, including Stop, in both Linux Chromium and Linux WebKit. This
resolves the unsupported-action uncertainty for that observed run. It does not
prove the precise wrapper-lifetime mechanism behind the older missed capture.

Shared setup previously fetched a checked-out public file over a second loopback
connection solely to apply two intentional test overrides. It now reads the exact
source file once and fulfills the fixture with the same directory/auth overrides,
JavaScript MIME and no-store policy. Four RED→GREEN cases reproduce a reset at
that boundary, execute both auth modes, and preserve pre-injected settings. No
network or assertion retry is added; production config is untouched. Actual
preview/production journeys continue to execute their unmodified served config.
The fixture matches only the exact HTTP loopback `/config.js`, so it cannot mask
a nested missing asset, a foreign origin or a credential-bearing request.
Fresh full verification, complete browser qualification and same-reviewer
follow-up remain required before publishing this correction.

The hermetic config source then passed the complete local matrix: 422 cases in
17.6 minutes, one worker, zero retries/failures/flaky/skips. Its four-case follow-up
review is clear. After that frozen campaign completed, a CI-only
`failOnFlakyTests` policy was added using the existing pinned Playwright option.
Diagnostic retries remain enabled in CI, but a flaky result must fail the job.
A controlled synthetic test, without a browser or server, demonstrated the old
one-flaky/exit-0 behavior and the new CI one-flaky/exit-1 behavior; local mode
remains exit 0. Browser assertions, timeouts and workload are unchanged. The
synthetic policy fixture is ignored and is not part of the real suite or release.
Final canonical verification, policy-delta review and clean hosted acceptance
remain required; green badges with a flaky log are never sufficient.

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
