# Build state

## 0.34.0 web delivered; desktop qualification held on directory coverage

PR #48 merged as `644e19f289fe2b92bf2e4dad118144083a39d4a5`. All ten head/main
checks pass, both hosted browser logs report 330 passes with no flaky cases, and actual
production matches 106/106/19 files with headers, 15 routes, four account-enabled UI
contexts and an installed-worker/offline check. Original main is clean at the
same source; 435 hashes verify. Desktop 0.34 candidates match 128 app files and
production metadata, with 87-file Windows payload parity and local CMS/timestamps.
They are unpublished and retained separately from stable 0.32.2.

Fresh publication 43103795772 exposed a coverage gap: Dublin has 3 programs in the
global 10,000-row root and 30 in its 196-row Ireland shard. Native sampling also
returns 3. The loss occurs at the producer cutoff. A new
pure selection helper has ten focused passing checks. The feature-branch producer
integration protects qualified city witnesses before clipping and rejects an unmet
legacy or grouped minimum, without extra requests or location guesses. The inactive
core passed 675 tests, three existing Windows skips and 439 hashes. Integration
passes 46 focused producer/protocol cases and 37 browser/loading cases. Fresh live
input replay restores Dublin to five, retains 10,000 rows and all country views,
and passes eleven-city native sampling with one root read. Full integration
verification passes 679 tests, three existing Windows skips and 441 hashes.
Review and publication are pending; production still uses the prior selector.
See the [correction design](superpowers/specs/2026-11-11-directory-place-minimum.md).

## 0.34.0 place-first source qualification

The ER-05 branch integrates conservative place/genre/time copy across rows,
player facts and tooltips, retains raw song input independently, and moves the
original stream choice and diagnostics into Details and Settings. Candidate
identity is coherent 0.34.0/v76-place-first. See [place presentation](PLACE_PRESENTATION.md)
and [qualification](QA-0.34.0.md). No new dependency, service or boot fetch.
The inactive core passed 658 tests and 430 hashes. Integration passes 665 tests
with three existing Windows skips and 435 hashes, all 330 browser cases without
retries, the 42-scenario rendered matrix and isolated Windows ARM64 renderer/auth/
encrypted-restart checks. Fresh review found one P2 Details refresh-focus issue;
it was reproduced in both engines and corrected with six focused checks and the
full green post-correction suites. Hosted and production acceptance followed as
recorded above; desktop publication awaits the directory correction.

## 0.33.1 web delivery — verified

PR46's Today UI merged as `5e9742834ad78b1ee1f41c33fa92d21d4bf26569` after all ten
head checks, matching previews and actual hosted UI. Production matches 104 files
on each app origin and 19 website files, with headers and 15 route checks. Its
account-enabled production keyboard check then found that a mounted hidden account
dialog disabled Settings focus containment. The bounded correction uses the
existing visible-state flag, adds enabled/disabled account coverage and advances
coherent 0.33.1/v75 cache identity. Twelve focused Settings/account cases pass
after four observed failures. Full local gates now pass 652 tests/three existing
Windows skips, 425 hashes, 278 browser cases at three workers, 42 rendered scenarios
and native ARM64 sandbox/auth/restart checks.
PR47 merged as `3ebd300af6d4189d3be3ee40e3f31f9560291b54`. All ten head and main
gates pass; both hosted browser runs report 278 passes with no flaky cases.
Production matches 104 files per app origin and 19 website files, with headers
and fifteen routes. Actual Chromium/WebKit at phone/desktop widths explicitly
mounts the hidden account dialog and verifies Settings, visible Google/GitHub/email
controls, Today/Search/Library and muted buffered Classic Vinyl HD. The original
checkout is clean at the same main. This does not establish fresh OAuth/email
completion or physical devices. Spaces records the delivered state and limits.
See [0.33.1 qualification](QA-0.33.1.md). Original accounts and providers are unchanged.

## 0.33.0 Today implementation — superseded by 0.33.1

Branch work integrates a frozen UTC city calendar, bounded opt-in native seeds,
Today/Continue/On air presentation, Atlas/Library/Search primary navigation and
an actionable idle player. It retains the existing catalog, station-intent,
audio, counter, song, account and sync owners. Candidate runtime/module URLs and
v74 shell are coherent. See [contracts, validation and rollback](TODAY.md).

The core commit passed 645 tests with three existing skips and 414 source hashes.
Local post-review checks now pass 652 tests with the same three skips, 422 hashes,
all 274 browser cases at the documented three-worker setting, 42 rendered Electron
scenarios and native ARM64 sandbox/auth/restart checks. See the
[qualification record and retained timing observation](QA-0.33.0.md).
The fresh review's four P2 findings have covering failing-then-passing tests.
PR46 passed source/preview gates and deployed. The subsequent account-enabled
production finding is corrected and qualified in 0.33.1 above. No 0.33 desktop
binaries or tag were published; 0.32.2 stays immutable.

## Place/time foundation prerequisite

The prerequisite added eleven curated Natural Earth/IANA identities, a conservative pure
station-place resolver, an explicit local-time formatter and a bounded file-only
coverage qualifier. That prerequisite did not change active home/map/player,
directory producer, loader, account, sync or worker entry points. Today consumed
it in the next phase; place-first work follows. The frozen 10,000-record qualification gives 9,400 program
components; all eleven curated cities have at least five components with city
evidence. This is a small prerequisite, not broad geocoding coverage or future
stream-availability acceptance. See [model/provenance/rollback](PLACE_MODEL.md).

## 0.32.2 desktop/distribution delivery

ER-01, ER-02 and ER-07 landed through PRs 39, 40 and 42, with the narrowly scoped
WebKit readiness correction in PR 41. PR 43 merged as final package source
`b5f2546ccff2154e7598005105984816c825c476`; all ten required main checks and the
existing directory publisher's build/deploy passed. Local verification passed
606 tests with three skips, 201 browser cases, 42 rendered scenarios, native
synthetic auth/restart and 395 committed hashes. Production matches 98 public
artifacts on each app origin and 19 website artifacts, including headers; route
and actual installed-worker offline checks passed.

[v0.32.2](https://github.com/Protonmatter/earth-radio/releases/tag/v0.32.2) was
published November 11, 2026 at 10:36:31 UTC. Windows ARM64/x64 installer/portable
and both native Mac DMGs match all 120 application files and the locked builder's
complete production package metadata. Windows payloads match 88 physical files;
local signatures, RFC3161 binding, isolated startup and guest favorite/volume
restart without autoplay passed. Mac architecture, DMG/mount, ad-hoc signature,
approved icon and native startup passed. All thirteen draft and anonymous public
downloads passed full size/SHA-256 checks; the prior v0.32.1 assets remain unchanged.

The website/docs-only follow-up advances static fallback metadata to that verified
release. It does not alter packaged application files or retarget the release tag.
Windows public trust, Apple notarization, physical installation/upgrade, fresh
public-provider signup and human audio fidelity remain outside this qualification.
See the [0.32.2 record and rollback](RELEASE-0.32.2.md).

## 0.32.1 precision identity delivery

PR #36 merged approved identity source de0e621 into main as 1d95684. This patch
advances the immutable desktop version and coherent module/cache generation, and
uses the approved artwork for native Windows/Mac icons. Final source, CI, served
parity and package/download qualification are recorded in release provenance and
Spaces after the source freezes; this note alone does not assert those gates.
See [release boundaries](RELEASE-0.32.1.md). Physical-device behavior remains open.

## 0.32.0 normalized directory and grouped streams candidate

The producer prerequisite was merged as PR #33 after all ten exact-head checks.
Its first GitHub Pages publication (run 42559123011, source 09e553c) completed and
the public manifest/payload hashes plus live reader 200/304 were verified. It adds
no paid service, saved key, source-history writes or dependency. The hourly workflow
is enabled; scheduled execution remains best effort.

The candidate reader verifies published hashes, preserves old array clients and
serves explicit grouped data with content ETags and generation status. Browse/map/
search group program streams while retaining UUIDs, saved aliases and deep links.
The quality picker prepares explicit Play; footer Play and bounded sibling recovery
use that choice. Native/browser truncation preserves popularity ordering. HTTP
choices are disclosed; country inference and coordinates remain conservative.
Actual Windows qualification caught a native merge that assumed optional source
claims existed on overlapping root/country records. The guarded merge and overlap
regression now preserve the normalized snapshot path; a real Electron HTTP route
returned the snapshot source and generation metadata after the correction. Final
packages must show that path, rather than merely proving live fallback can load.

Catalog success no longer creates a covering toast. Atlas fallback/view bounds
exclude Antarctica while keeping those stations listed. The viewport establishes
its view before raising minimum zoom, avoiding a Leaflet animation that ignored
mobile Fit. Root no-transform prevents automatic beacon injection without expanding
CSP trust. Local verification passes 557 tests with three existing skips;
five tooltip/Fit and four grouped playback/identity cases pass. Final frozen browser,
rendered/native, hosted, exact-head CI and release qualification still gate delivery.
See [release gates](RELEASE-0.32.0.md) and [publication runbook](DIRECTORY_PUBLICATION.md).
Final identities and physical qualification boundaries belong in release provenance
and Spaces. No account/provider/schema, SMTP, vault or signing-trust change is made.
Final compact-control geometry and accessible names pass 174 browser cases, including
all six locales. Mac CI prepares the pinned Electron runtime with bounded official-
installer retries and bundled checksums before running unchanged application tests.

## 0.31.0 directory reliability candidate

This candidate adds a finite same-origin cached directory, dynamic mirror health,
strict-before-fuzzy search, generated locale/place vocabulary, diverse opening
results and explicit country-level approximate map positions. Large geography is
lazy and immutable, with legacy URLs retained for already-open tabs. Shell precache
is about 1.92 MB, down from 33.72 MB (94.3% less). Focused cache/search/map tests,
one-request Chromium/WebKit boot, targeted-country retry, legacy loader and installed
Chromium offline-shell checks passed during development. Final local gates passed
495 tests (three skips), 149 browser cases, 42 rendered scenarios, seven standalone
cases and Windows renderer/auth/lifecycle checks. Hosted/live preview and release
qualification still gate publication. No new paid service
or dependency is configured. See [release gates](RELEASE-0.31.0.md) and
[technical operations](DISCOVERY_RELIABILITY.md); final delivery receipts belong in
release provenance and Spaces.

## 0.30.0 station search

Browse and Search share the maintained ranker, query and country scope. Searchable
genre/language widgets, removable active constraints and query-preserving recovery
make refinement explicit. Format/region/alias/transposition matching remains bounded
and tab-local. Container resize observation keeps filtered station rows readable.
Account/playback contracts and bounded directory loaders are preserved. See
[release gates](RELEASE-0.30.0.md) and [qualification](QUALIFICATION-0.30.0.md).
Final publication identities belong in release provenance and Spaces.

## 0.29.1 website and app domains

The product website and downloads use `earthradio.stream`; listening and optional
account sync use `app.earthradio.stream`. Two Pages projects share this repository.
The marketing build is static and has no application Functions or account session.
The original `earth-radio.pages.dev` app stays available. Browser storage remains
origin-scoped; synced collections load after sign-in, and unsynced collections can
be exported at the earlier address. See [domain operations](DOMAINS.md) and
[release gates](RELEASE-0.29.1.md). Final deployment identities are recorded in
release provenance and Spaces after verification.

## 0.29.0 compact player and songs

The compact Now Playing card keeps the feed and grouped controls together. Song
details and broadcast provenance use a separate dialog. Private profile history and
likes use a bounded fourth sync document, explicit guest import and account-fenced
storage/backup recovery. See [feature and rollback](SONG_LIBRARY.md) and
[publication gates](RELEASE-0.29.0.md). Final delivery identities are carried by the
GitHub release provenance and the existing Spaces operations record.

## 0.28.0 geographic atlas

This candidate adds bounded station tooltips and bundled Natural Earth country/city
labels, country and regional borders, lakes, rivers and selected roads. Data-only
assets load by zoom; directory and playback ownership remain with the existing runtime.
Independent label preferences are local to the device. No map service, subscription,
new dependency or credential is required. See [map provenance](MAP_DATA.md),
[release gates](RELEASE-0.28.0.md) and [qualification scope](QUALIFICATION-0.28.0.md).
The GitHub release provenance and Spaces operations record carry final publication
identities after exact-source CI, production parity and desktop verification.

## 0.27.0 listening room

The approved desktop/mobile presentation uses compact, single-column station rows,
Paper by default for new profiles, retained Night preferences, clearer navigation,
and quieter bundled-map controls. Runtime `index-a673e435.js` and shell v59 carry
version 0.27.0. Discovery and account behavior retain their existing contracts.
The large-catalog regression covers finding an unrendered station, end-of-list
selection, no-result reset and a cached directory reload while its source is down.
See [release identity and gates](RELEASE-0.27.0.md) and [qualification](QUALIFICATION-0.27.0.md).
The release provenance and Spaces operations record retain the final commit,
exact-head CI, production parity and binary verification receipts.

## 0.26.0 desktop distribution

The [release record](RELEASE-0.26.0.md) and [installation guide](INSTALLATION.md)
cover Windows ARM64 setup/portable, Apple Silicon/Intel unnotarized DMGs, verified
email sign-in and Home Screen installation. Final distribution requires exact-source
CI, packaged-source parity, signatures/DMG verification and release download readback.
`BUILD-PROVENANCE.json` on the release carries the final source and binary identities.

PR #20 merged as `7998245b2d6b056947149149bed1c40abd83e3b7`, with all nine PR and
main checks passing. Cloudflare production `af9d0bf7-492e-4aea-86bd-23ab737a1f46`
served all 47 public files with matching hashes, runtime `index-8fd01303.js` and an
activated controlling v56 worker. Live map search returned 10,000 mapped stations.
The desktop distribution follow-up changes documentation/manifests only; compare its
final tag to this application-source cut before claiming payload parity.

## 0.26.0 account candidate — 2026-11-04

The [0.26.0 qualification record](QUALIFICATION-0.26.0.md) now includes the
2026-11-05 Windows installer follow-up: an isolated 0.25.1 → 0.26.0 upgrade,
86-file installed payload parity, saved favorite/55% volume preservation, clean
candidate startup and both uninstall paths passed. The original 0.24.0 executable
and registration stayed unchanged. This does not claim an original-identity
upgrade or establish fresh outside-team OAuth signup or physical-device account coverage.

[PR #20](https://github.com/Protonmatter/earth-radio/pull/20) adds main-owned native
PKCE sign-in, OS-encrypted sessions, restricted account IPC, single-instance ownership
and a normal-quit flush gate. It preserves the existing RLS/CAS sync contract. The
candidate's embedded runtime/package version is 0.26.0, runtime `index-8fd01303.js`,
and shell generation v56. No private provider credential or new dependency was added.

The readiness follow-up reproduces a real encrypted-session deletion failure in an
isolated native profile. A failed sign-out now reports an incomplete state, keeps sync
and linking paused, preserves the account namespace and allows an explicit retry after
storage recovery. The native regression retries successfully before switching accounts.
Keyboard regressions also cover Tab/Shift+Tab containment, focus preservation across
provider discovery and mobile focus return to the visible More actions trigger.

The subsequent dependency audit identified 16 affected package nodes (5 high and
11 moderate), including shipped Electron 43.4.1. The candidate now pins 43.8.7 and
uses bounded build-tool overrides for patched glob/minimatch lines. CI adds a published
advisory gate. [Dependency security](SECURITY.md#dependency-security) records scope,
compatibility checks and rollback. Every older desktop candidate predates this runtime
security update and must be superseded before publication.

Final rendered qualification exposed a background-observer timing gap in the previous
header floor. The effective CSS header depth now clamps to 56px for the header and
dependent panel positions. A synchronous regression injects a 9px metric and requires
the 47px-safe-area header to retain its content before observer delivery; the focused
rendered check measured a 103px header while the raw metric was still 9px.

Live Windows source tests completed Google and GitHub callbacks with existing owner
accounts, reached Synced, restored Google's encrypted session after restart, and
verified logout/account isolation. A favorite added on desktop arrived on production
web; web removal arrived on desktop. A web volume change was confirmed through the
desktop's supported JSON export, then the original value was restored and verified
in the hosted configuration row. No fresh outside-team identity was supplied.

The reviewed implementation passed Windows ARM64 native tests locally, Windows x64
and macOS ARM64/x64 auth/vault/lifecycle tests in CI, local GoTrue/Mailpit/PostgREST
integration, and the 49-case browser suite. Candidate DMGs are ad-hoc signed and
unnotarized; verification checks the DMG, architecture, packaged source hashes and
bounded startup. See the [current PR checks](https://github.com/Protonmatter/earth-radio/pull/20/checks)
for the exact final source and platform results, and [account operations](AUTHENTICATION.md)
for evidence boundaries and rollback. Earlier candidate artifacts are superseded when
the source SHA changes; no existing release tag or published asset is replaced.

**Sender infrastructure update (2026-11-06):** the owner registered
`earthradio.stream` through November 6, 2029. Registry and public DNS readback confirmed
its Cloudflare nameservers; WHOIS redaction is enabled. DNSSEC is now validated: both
public resolvers authenticated the DS, DNSKEY and DKIM TXT answers at 22:10 UTC.
The selected sender is `Earth Radio <signin@auth.earthradio.stream>`.

**Live email and restart passed (2026-11-06):** Resend is connected and the sender domain and required
records are Verified. All four DNS values, including the initial DMARC monitoring
policy, matched through two public resolvers. A domain-restricted sending key was
stored in Windows Credential Manager with encrypted readback, then configured in
Supabase SMTP and reload-verified. A new authorized external Gmail alias completed
real confirmation on production web, with Inbox delivery and SPF/DKIM/DMARC passing.
The Windows ARM64 client completed a live email PKCE return, imported the web favorite
and 55% volume, and synced a change to 61% back to web. A normal quit/relaunch without
diagnostic hooks restored its encrypted session, favorite and 61% volume and reached
Synced. The QA application was closed normally. The original Earth Radio login was
restored through GitHub, with Synced and the original 74% volume verified after reload;
GitHub account settings were not changed. Other mailbox providers, fresh outsider
OAuth identities and physical Mac/installed iOS account returns remain untested.
The approved native loopback return was saved in Supabase; existing web origins,
hosted provider settings and schema are preserved. Production and published v0.25.1
downloads remain separate from this candidate until its release gates close. The
fresh 2026-11-06 npm audit reported zero known advisories; all nine PR checks passed
on `d587d8d` before this sender-verification documentation follow-up.

## 0.25.1 safe-area correction and Git delivery

The user subsequently authorized committing/pushing the release, passing CI and
merging into main. [PR #17](https://github.com/Protonmatter/earth-radio/pull/17)
delivers the release through that workflow. Its Windows check exposed a real
header measurement latch: a 47px inset was subtracted from a transient 56px total
height, preserving only 9px of content depth and clipping the controls. The new
guard restores the 56px design floor; a deterministic red/green rendered scenario
proves recovery and containment. Runtime/package 0.25.1 and worker v52 carry the fix.

See [RELEASE-0.25.1.md](RELEASE-0.25.1.md) for the correction, source/artifact
identity and CI/deployment requirements. The current exact GitHub checks and
merge-triggered Cloudflare deployment identify the final delivered revision.
The 0.25.0 publication and qualification below are historical evidence. Public
desktop trust remains deferred under the accepted local-signing decision.

## Production 0.25.0 — 2026-11-03

The user authorized production publication and accepted local desktop signing.
Production is now <https://earth-radio.pages.dev/>, deployment
`77a8499e-e8ed-4ae8-a047-4a362306eb86` (**Production**, branch `main`), immutable
URL <https://77a8499e.earth-radio.pages.dev/>. The shell generation is **v51** and
the runtime is `index-84264652.js`. All **45 public files**, including the staged
asset manifest, matched the local artifact by SHA-256 after publication. CSP/HSTS
and actual v51 service-worker control/cache were verified.

The private metadata quota Worker is deployed. Live preview and production each
accepted 30/32 now-playing and 6/8 fingerprint probe requests; the excess returned
429 with Retry-After. Production aliases/encoded routes shared the budget; preview
and production budgets remained independent. Both endpoints recovered after the
60-second mitigation. No recognition providers are configured. This is durable
application rate control and does not eliminate invocation-volume costs.

The final ARM64 setup/portable builds include the current map, generated icon,
version and privacy disclosure. All 59 packaged application source files matched
the repository. Portable payload parity covered 87 files; clean installed lab
payload parity covered 86 files. An isolated 0.24.4 → 0.25.0 upgrade preserved the
saved station and 55% volume, and final uninstall removed its executable/registration
while preserving its separate profile. The original installed application was
not replaced. Local signatures/timestamps are present; Windows does not trust
the self-signed publisher. No Root certificate was installed.

Validation passed: **386 Node tests / one Windows symlink-policy skip**, metadata
and desktop proxy smokes, **49 Chromium e2e tests**, the **41-scenario** rendered
matrix, sandboxed renderer Origin smoke, and a real SQLite/DO lifecycle harness.
Production live world search returned 10,000 mapped stations; Classic Vinyl HD
playback advanced with readyState 4 and was paused afterward. The existing hosted
account displayed Synced. The user confirmed the physical installed preview/map
works; precise device/OS and lock-screen audio results are not inferred.
The production phone viewport showed 9,761 mapped stations without horizontal
overflow. Bounded observations through 02:01:17 UTC (about 15½ minutes from first
publication checks) retained correct shell hashes and healthy API probes. This
is a smoke window, not a long-term availability or load qualification.

The initial publication was a verified working-tree upload based on `81c5e59`;
it did not imply a source commit/push or remote CI result. The user subsequently
authorized committing/pushing the release, passing CI and merging into main.
This source delivery reconciles the qualified runtime/configuration with GitHub
through a release pull request. Use the PR/main commit checks for exact CI status
and verify the resulting production deployment against the same public hashes.
See [RELEASE-0.25.0.md](RELEASE-0.25.0.md) for artifact hashes, evidence, release
exceptions and guarded rollback. Earlier sections below are historical and their
pending/hold statements are superseded by this record.

## World map area-search follow-up — 2026-11-03

The user installed the initial preview as a Home Screen web app and reported good
general use, then found that Search this area did not populate regions outside
Germany. The first implementation only filtered the initial bounded catalog.
The correction now loads a bounded world mapped directory on demand, clears
conflicting geographic/view state, retains music filters, and provides visible
loading/retry/clear controls. A live loader run returned 9,998 valid mapped
records across 184 country codes. This is a sample, not exhaustive coverage.

Current approved preview: <https://qualification-atlas-20261103.earth-radio.pages.dev/>,
immutable deployment <https://7ab4d912.earth-radio.pages.dev/>, ID
`7ab4d912-e292-485b-9a5e-d319722dca9a`, worker **v50**. The runtime is now
`index-597f6388.js`. The first Home Screen shortcut used an immutable deployment;
use the stable alias for a replacement shortcut that receives later preview updates.

Final live browser verification populated **9,798 mapped stations** in a world
rectangle and **1,027** after zooming into South America. The stable alias and all
45 public files match the staged candidate; the phone-sized document had no
horizontal overflow. Physical revalidation of the map correction is pending.

Checks passed: **374 Node tests / one Windows symlink-policy skip**, **49 Chromium
e2e tests**, **41 rendered scenarios**, real sandboxed file-renderer Origin smoke,
and **205 deterministic release hashes**. Independent review closed toggle-state,
SDR-domain and malformed-record retry issues; live verification additionally
caught and corrected a pinned-overlay response-cap interaction. The old desktop
installer binaries predate this map fix and require rebuilding before distribution.
Production remains deployment `f9631de3-21e5-4080-8d66-ed74c0577373` on `main`.

## Approved Pages preview — 2026-11-03

The user approved publication of the uncommitted candidate to a separate public
HTTPS preview: <https://c6b13e3d.earth-radio.pages.dev/> (branch alias
<https://qualification-atlas-20261103.earth-radio.pages.dev/>), deployment
`c6b13e3d-b504-426d-aefe-c7fd7d8094a5`, environment **Preview**. No commit or push
occurred. All **44 public files** including the generated asset manifest match
the staged candidate by SHA-256. The v48 worker is active/controlling; browser
smoke loaded **3,273 live stations**, played Classic Vinyl HD, and rendered the
new icon and 127 atlas features at 390 × 844 without horizontal overflow.

Production remains deployment `f9631de3-21e5-4080-8d66-ed74c0577373` on `main`;
its HTML and v46 service-worker hashes were unchanged after the preview upload.
Authentication stays restricted to production. Google and GitHub return flows
have now separately shown their provider linked and **Synced**; this does not
establish a single combined provider identity. Physical iPhone/iPad results on
the new preview remain pending. Durable edge limits and trusted signing still
block full production qualification. See the [qualification record](QUALIFICATION-2026-11-03.md).

## Live release qualification — 2026-11-03 follow-up

See [QUALIFICATION-2026-11-03.md](QUALIFICATION-2026-11-03.md) for current evidence,
exact deployment identity and remaining release gates. The explicitly approved
Supabase restore completed and the project is `ACTIVE_HEALTHY`. An existing live
session recovered; fresh Google sign-in returned **Google linked / Synced**.
The later GitHub return displayed **GitHub linked / Synced**. Strict-public routing is configured, but
durable edge rate enforcement failed the bounded probes. Three real stream
samples decoded successfully; this does not establish perceptual fidelity.

The local candidate now uses the ChatGPT-generated globe/radio icon and worker
v48. Public production still serves v46 from commit `36296139`; the user's old
phone page alone is not proof of a caching defect. Physical iOS/installed-PWA
results remain pending. The new atlas/icon are available on the approved preview
above; they have not been deployed to production.

Automated checks: **365 Node tests passed / 1 Windows symlink-policy skip**, all
**43 Chromium e2e tests**, all **41 Electron rendered scenarios**, and the real
sandboxed file-renderer Origin regression smoke passed. Signing credentials are
unavailable; desktop artifacts remain unsigned. Current installer-lab results
and limitations are maintained in the qualification record. The earlier local
candidate section below describes the first validation phase, before these live
checks and packaging fixes.

## Local discovery/atlas candidate — 2026-11-03

This is an uncommitted, undeployed working-tree candidate based on local HEAD `81c5e59`. The public deployment identities below are historical and were not re-qualified or changed by this work.

Implemented: maintained explainable discovery modules, Unicode/typo-aware search, genre/language/bitrate/security filters, reliability/diversity/similarity selection, device failure cooldowns, station explanation dialogs, a bundled Natural Earth vector atlas, and map-area/fit/focus controls. The runtime remains the recovered application with narrow maintained-module hooks; it has not become a reproducible TypeScript build. See [DISCOVERY.md](DISCOVERY.md) and [MAP_DATA.md](MAP_DATA.md).

Qualification: **341 Node tests passed / 1 Windows symlink-policy test skipped**, plus metadata and desktop proxy smokes; all **43 Chromium e2e tests** passed; the **41-scenario Electron rendered matrix** passed its layout/action/locale assertions with no skip or scenario error. The complete `npm run verify` pipeline passed and verified **193 deterministic release file hashes**. Local staging validates **39 source files / 40 staged files** and 34 references. An offline browser smoke confirmed all five discovery/map assets cached, an uncached request blocked, and all 127 land features plus the cached nine-station fixture directory rendered after reload. Tests use hermetic station/audio fixtures. No real station uptime, local GoTrue/hosted authentication, metered identification provider, production edge/WAF configuration, physical phone, desktop signing, installer, or deployment was tested.

Independent read-only review identified two P2 refresh defects and the atlas validator false positive; all were corrected with regressions. Closure review identified no additional actionable P0–P2 defect in the reviewed changes. This is bounded review evidence, not a security certification.

The new discovery copy is currently English. Existing locale chrome remains intact. Offline atlas geometry requires a successful shell cache installation; live audio/catalog updates still require networking. The 1:110m map is a global discovery surface and intentionally stops at zoom 7.

Status date: 2026-08-23. Candidate version: `0.24.0-recovered.1`.

## Validated

- The additive Atlas Editorial layer, six structurally complete UI catalogs, destination/split/collapse contract tests, and service-worker cache-version checks pass locally via `npm run verify`. Localization updates attributes or visible text, not both, so play/search glyphs remain. Engineering-authored catalogs are identified as such.

- Both supplied ZIP inputs were hashed and inventoried; recovery selection is captured in `docs/provenance/recovery-manifest.json`.
- The installed executable reports Earth Radio 0.24.0 and is not Authenticode signed.
- Locked dependency installation completed with Node.js 24.18.0 and npm 11.16.0.
- Repository safety, JavaScript syntax, deterministic inventory/staging/manifest, static-boundary, metadata, and desktop proxy checks pass locally.
- Desktop proxy regression checks cover per-launch route authorization, Origin enforcement, IPv4-mapped IPv6 normalization, carrier-grade NAT blocking, and DNS rebinding defenses.
- The Electron entry point and packaging configuration both target the selected `site/` directory.
- Static output validation rejects localhost proxy configuration, missing assets, source-map files or references, and files outside the allowlisted publish boundary.
- Local CI policy validation confirms Linux/Windows jobs, read-only permissions, no secret references, and immutable action pins.
- A Chromium smoke test against `.build/site` loaded 3,912 current Radio Browser stations, exercised command-palette search and filters, restored the last station/catalog from local persistence after reload, activated `sw.js`, and played the HTTPS 320 kbps MP3 stream for Classic Vinyl HD on 2026-08-22.
- The browser audit found and verified a repair for late service-worker registration; the post-fix reload had one active controlling worker and zero console errors/warnings.
- `npm run pack:desktop` produced a Windows ARM64 unpacked application; ASAR inspection confirmed `electron/proxy-rules.mjs`, `server/desktop-proxy.mjs`, and `site/index.html` are present, while `server/example-proxy.mjs` and production `node_modules/` are absent. The packaged executable SHA-256 was `5FE78FC3C3E533A2C123E9600EC821CD7E0AD2DA496277DB53FB2061BF4356B9`.
- The public repository is `https://github.com/Protonmatter/earth-radio`. Pull request #3 merged the cache-upgrade fix into `main` as `308e8e166237f556e081bdd02395d298de842b6a`.
- GitHub Actions CI passed on Ubuntu and Windows for merge commit `308e8e166237f556e081bdd02395d298de842b6a` at https://github.com/Protonmatter/earth-radio/actions/runs/32621297942.
- Cloudflare Pages production deployment `ef9d01f4-0471-4a66-a086-25b4e4579474` succeeded for the merge commit. All 22 public files in the generated asset manifest matched the files at `https://earth-radio.pages.dev/` by byte length and SHA-256.
- Live cache headers grant one-year immutable caching only to the hashed runtime assets. Maintained overlays, `config.js`, and `i18n/*` revalidate after five minutes. `sw.js` is `no-cache` and serves `earth-radio-shell-v25-responsive-7` with reload-on-install.
- A public Chromium catalog/search smoke was recorded against the previous production baseline on 2026-08-23 and was not re-captured after this cache-policy deploy. File identity, cache headers, and service-worker source were re-verified from the live origin.

## Not validated

- Desktop installer creation, launch/runtime behavior, Authenticode signing, installation, upgrade, and rollback have not been validated from this recovered repository. The unpacked packaging candidate is unsigned and uses Electron's default icon.
- Live station behavior depends on current third-party catalogs, CORS, codecs, and stream uptime. Direct iTunes metadata lookup returned HTTP 403 for one raw station label during smoke testing and degraded to raw ICY metadata as designed.
- The recovered TypeScript tree is not proven to rebuild the selected installed hashed JavaScript bundle.
- Physical iOS Safari, installed-PWA, VoiceOver, and native-speaker editorial review of the six UI catalogs have not been captured. Catalogs are engineering-authored.

## Live deployment

Production is live at `https://earth-radio.pages.dev/`. The verified baseline is merge commit `308e8e166237f556e081bdd02395d298de842b6a`, GitHub Actions run `32621297942`, and Cloudflare Pages deployment `ef9d01f4-0471-4a66-a086-25b4e4579474`.

File identity and cache policy were re-verified after this deployment. Physical iOS Safari, installed-PWA behavior, VoiceOver, native-speaker translation review, and every third-party station stream remain outside the verified production scope.
