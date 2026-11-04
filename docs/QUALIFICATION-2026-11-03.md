# Earth Radio release qualification — 2026-11-03

**Historical qualification record.** The later [0.25.0 production release
record](RELEASE-0.25.0.md) supersedes the hold/pending statements below. The user
confirmed the installed-PWA map correction works, accepted local-only signing,
and authorized production deployment. Version 0.25.0 is now production deployment
`77a8499e-e8ed-4ae8-a047-4a362306eb86`, with remotely verified durable rate control
and rebuilt ARM64 packages. Public publisher trust remains explicitly deferred.

This record separates the uncommitted local candidate from the public deployment.
No code was committed or pushed during this qualification. After the user's
explicit approval, the local candidate was uploaded to a separate Cloudflare
Pages preview; production's deployment and shell hashes remained unchanged.
The production service state change was the user's explicitly authorized
restoration of the existing Supabase project. Schema, provider settings,
Cloudflare rules, domains and recognition-provider credentials were not changed.

## Decision

**Hold public release qualification.** Live checks improved the evidence and
identified actual defects, but durable edge limits, trusted signing and physical
iOS/PWA results remain gates. Google and GitHub live return flows completed;
an existing session recovering alone would not establish those results.

The local candidate is based on `81c5e59642483d855a6563629f82c8c953db0d65`.
Cloudflare's dashboard identified production as commit
`36296139a6cd6379f66ff3157c774301f49158a7`, deployment
`f9631de3-21e5-4080-8d66-ed74c0577373`, at
`https://earth-radio.pages.dev/`. Live public tests exercise that deployed build;
they do not establish deployment of the new discovery, atlas or icon to production.

## Approved HTTPS preview

Current map-corrected preview: <https://qualification-atlas-20261103.earth-radio.pages.dev/>.
Its immutable URL is <https://7ab4d912.earth-radio.pages.dev/>, deployment
`7ab4d912-e292-485b-9a5e-d319722dca9a`, worker
`earth-radio-shell-v50-world-map-directory-2`. The v48 record below is historical.
The first Home Screen shortcut used an immutable preview URL and therefore does
not follow later deployments. Recreate it using the stable branch alias for
ongoing preview updates. Production remains v46 and was not replaced.

The initial v48 deployment below was installed as a Home Screen web app by the
user, who reported that it worked and looked good. The user then reported that
Search this area did not populate stations outside Germany. This feedback led
to the map correction described next; it is not evidence of a fully qualified
lock-screen audio or device/OS compatibility matrix.

On 2026-11-03, after the user approved public preview publication:

- Immutable deployment URL: <https://c6b13e3d.earth-radio.pages.dev/>.
- Branch alias: <https://qualification-atlas-20261103.earth-radio.pages.dev/>.
- Deployment ID: `c6b13e3d-b504-426d-aefe-c7fd7d8094a5`.
- Environment: **Preview**; logical deployment branch:
  `qualification-atlas-20261103`. No Git branch/commit/push was created.
- Source metadata identifies HEAD `81c5e59` plus an explicitly dirty working tree;
  the candidate is not reproducible from HEAD alone. Public asset hashes below
  identify the actual uploaded site. Functions were compiled/uploaded by Wrangler.

The existing Wrangler 4.131.1 CLI was used without adding a project dependency.
Its expired login required renewal. The user separately approved installation
of its pinned global `@napi-rs/keyring@1.3.0` helper (plus the Windows ARM64
platform package). The refreshed CLI grant requests only `user:read`,
`account:read`, `pages:write` and Wrangler's required `offline_access`, a subset
of its previous grant. Credentials use Wrangler's encrypted file with the key
in Windows Credential Manager; no token was copied into the repository.

The upload command was:

```powershell
node '<existing-wrangler-4.131.1-install>/bin/wrangler.js' pages deploy .build/site --project-name earth-radio --branch qualification-atlas-20261103 --commit-dirty=true --commit-message 'Uncommitted discovery atlas and generated icon qualification preview 2026-11-03'
```

Current [Pages preview documentation](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
describes the immutable URL and branch alias. This used Pages branch previews,
not the separate newer Workers Previews product. No automatic-build settings,
production branch, domains, bindings or recognition secrets were changed.

Post-upload verification:

- All **43 public source files**, plus the generated asset manifest (**44 public
  files total**), matched local staged bytes by SHA-256. `_headers` is deployment
  configuration rather than a public file; CSP/HSTS were verified on the shell.
- Worker `earth-radio-shell-v48-earth-radio-icon-1` is active and controlling.
- `/api/nowplaying` returned HTTP 200 / `ok: true`; the fingerprint probe returned
  HTTP 200 / `available: false` / no providers. A loopback target returned HTTP 400.
- A browser smoke loaded **3,273 live stations**, exercised Classic Vinyl HD
  search/playback and observed the audio element playing at 18.50 seconds with
  `readyState: 4`. Audio was paused after the smoke.
- At a simulated **390 × 844** viewport, document width and scroll width were
  both 390, the new icon decoded at 192 pixels, and all 127 atlas land features
  rendered. Browser sizing was restored afterward. This is not a physical iPhone.
- The latest production deployment remained
  `f9631de3-21e5-4080-8d66-ed74c0577373` on `main`.
  Production `index.html` remained SHA-256
  `9aa1b819b77968d5468028461b71488100a0a8a3cf694c46ac18743c6ab877be`;
  `sw.js` remained
  `ba5d3ffcba9178308dff9ab71bfc0d066719d318ad717d10e36abe9ca1029328`
  (worker v46).

Evidence is ignored under `.build/qualification/`: `preview-deploy.log`,
`preview-verification.json`, before/after deployment lists and `preview-mobile.png`.
Authentication remains restricted to the exact production origin; preview sign-in
was not enabled. Use the **new preview URL** in Safari and create a new Home Screen
shortcut for physical testing; the existing production shortcut still opens v46.

### Map-area correction after physical-device feedback

The first area-search implementation captured a rectangle and filtered only the
bounded initial popular/featured-country pool. It made **no geo-directory request**;
an actual-runtime browser regression reproduced that omission before the fix.
That explains why filtering could not populate countries absent from that pool.

The maintained `map-directory.js` now loads a bounded mapped Radio Browser sample
on the first area search, normalizes it through the existing runtime, and augments
the catalog before filtering. It preserves richer base metadata, fills missing
coordinates, reuses the sample for the tab and allows retries after failure.
One 20-second deadline, two fixed endpoints, a 16 MiB per-response cap and a
10,000-record cap bound this metadata-only operation. This is not exhaustive
coverage of every country/rectangle. See [DISCOVERY.md](DISCOVERY.md).

Area search clears conflicting country/Favorites/Recent state, retains music and
quality filters, shows loading/failure/result notices, and exposes Clear area on
the phone map. Cancellation cannot apply stale results. It is disabled in SDR
mode. Invalid optional metadata is skipped per row, and non-primitive coordinate
values cannot discard valid neighbors. No new project dependency was added.

A live run of the actual loader returned **9,998 valid mapped records across 184
country codes** in about **4.6 seconds** on the development host: Germany 1,100,
Brazil 400 and Japan 9. This is point-in-time directory evidence, not stream health.
Nine loader/merge regressions and six new browser scenarios cover new-country
loading, cache reuse, limits, cancellation, retry, country/view conflict clearing,
SDR isolation and malformed metadata. The full browser suite passed **49 tests**;
the verification pipeline passed **374 Node tests / one Windows symlink skip**.
Independent review closed three P2 edge cases found during this correction.

Live v49 verification then caught a separate interaction: the pinned-station fetch
overlay appended two ungeocoded records to the 10,000-record response, so the
strict map cap correctly rejected it. The overlay now leaves `has_geo_info=true`
responses unchanged; pinned stations stay in the main catalog. A composed
overlay/loader regression reproduced the failure before passing with this fix.
The old `nl1` fallback returned a DNS failure during live testing; the current
server and existing `all.api` service alias are used instead. They are not
independent backends. The server list returned only `de1` at qualification time.

Worker v50 caches the added module and the runtime has a new content fingerprint.
The complete 41-scenario rendered matrix and real sandboxed file-renderer Origin
smoke passed. The final public asset/production-identity checks are recorded in
`.build/qualification/preview-map-final-verification.json`: all **45 public files**
including the generated asset manifest matched staged SHA-256 values, and the
stable alias matched the immutable preview. Production HTML/service-worker hashes
and deployment ID remained unchanged.

The final deployed v50 browser smoke successfully populated **9,798 mapped
stations** in its world rectangle at 390 × 844, then **1,027 mapped stations**
after zooming into South America and repeating Search this area. Browse showed
new regional records including a Brazilian station. The loading notice resolved
to a count rather than a retry error. The v50 cache was active/controlling and
the document had no horizontal overflow. Screenshots are `map-final-mobile.png`
and `map-final-south-america.png` under `.build/qualification/`.
The previously qualified unsigned desktop executables predate this map follow-up;
they are historical artifacts, not an installer build of the new map correction.
Rebuild and requalify those executables before distributing the updated desktop.

## Hosted authentication and database

- The existing project initially reported `INACTIVE`; Google and Cloudflare DNS
  resolvers returned NXDOMAIN for its Auth host. After the approved restore, its
  status became `ACTIVE_HEALTHY` and `/auth/v1/settings` returned HTTP 200.
- Hosted settings report Google, GitHub and email enabled. Apple and Microsoft
  remain disabled. Enabled settings alone do not establish OAuth callback success.
- The pre-existing production Chrome session recovered and the account dialog
  displayed **Synced**, without signing out or copying its tokens.
- A separate signed-out in-app-browser session followed **Continue with Google**
  to Google's real account selection and consent screen. The user approved the
  requested name/profile/email access. On return to the production origin, the
  account dialog displayed **Google linked** and **Synced**. This verifies the
  live Google return flow and subsequent client sync status.
- **Link GitHub** reached GitHub's real login page. The user completed the
  interactive flow; on return to production, the account dialog displayed
  **GitHub linked** and **Synced**. At that point it offered **Link Google**;
  these separate observations do not establish that Google/GitHub were linked
  into one shared identity. No GitHub password, token or passkey was obtained
  or saved by the agent.
- Read-only catalog inspection confirmed forced RLS on `profiles`,
  `user_preferences`, `favorite_stations`, `recent_stations`,
  `country_preferences` and `user_config_documents`. All observed policies are
  authenticated-only and compare `user_id` with `auth.uid()`.
- `upsert_user_config_document` has an empty search path, requires `auth.uid()`,
  scopes inserts/updates to that caller, restricts document keys and sizes, and
  compares expected revisions. EXECUTE is granted to `postgres` and
  `authenticated`, not anonymous/public roles. This live definition review is
  not a two-user hosted isolation or concurrency experiment.
- Security Advisor reports two warnings: authenticated execution of the
  intentional SECURITY DEFINER configuration RPC, and disabled leaked-password
  protection. The RPC warning was reviewed against its caller checks above;
  leaked-password protection remains an account configuration decision.

No hosted schema migration, provider change, password change, secret export or
global sign-out was performed. The Docker/local GoTrue integration suite was
not run on this host. Its absence is separate from the ordinary Windows
symlink-policy unit-test skip.

## Production edge

Observed in the Cloudflare account UI:

- `global_fetch_strictly_public` is enabled for production and preview, with
  compatibility date `2026-08-25`.
- Pages Functions environment variables/secrets are empty. The fingerprint
  probe confirms `available: false` and an empty provider list. No metered
  recognition-provider request was made.
- The account's domain inventory contains no zone. No controlled custom domain
  was available for the documented zone WAF rules.

Public probes verified HTTP 200 for the shell, CSP/HSTS and revalidating shell
cache headers, HTTP 200 for metadata capability probes, and HTTP 400 for both
loopback and same-origin fetch targets. These black-box responses do not prove
zero outbound fetches in production logs.

**Durable rate limits failed qualification:** a bounded sequence of 32 empty
`/api/nowplaying` requests and 8 empty `/api/track/fingerprint` requests returned
only HTTP 200. The documented policy is 30/minute/IP and 6/minute/IP with HTTP
429. No stream URL was supplied, so these probes requested no stream sampling
or paid recognition. Diagnostic summary: `.build/qualification/edge-probes.json`.

Cloudflare documents [rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
as zone configuration; [account-level rate-limiting rulesets](https://developers.cloudflare.com/waf/account/rate-limiting-rulesets/)
deploy to Enterprise zones. A `pages.dev` deployment with no controlled zone
does not establish the repository's required WAF control. Before release,
approve/configure a suitable controlled domain and edge rules, or implement and
review an alternative durable quota architecture. Repeat the bounded probes
and inspect logs to verify denied requests do not execute outbound work.

## Real stations and audio

Run explicitly, outside normal offline verification:

```powershell
node scripts/qualify-live-streams.mjs --live
```

Prerequisites: `ffprobe` and `ffmpeg` on PATH. This opt-in diagnostic uses the
application's public-address/DNS/redirect guard. It requests at most 40 directory
entries and three stream samples, each capped at 128 KiB and 25 seconds; local
decoder subprocesses have 15-second deadlines and bounded output. It persists
measurements, not audio or raw stream URLs, under `.build/qualification/`.

The directory returned 40 records, 40 claiming a successful recent check and 27
with HTTPS endpoints. Three selected HTTPS samples returned HTTP 200:

| Station | Declared / decoded codec | Decoded signal | Peak / RMS dBFS | Decoder errors |
| --- | --- | --- | --- | --- |
| Europe 1 | AAC / AAC | 48 kHz stereo | -3.88 / -16.69 | 0 |
| Radio Armisa | MP3 / AAC | 44.1 kHz stereo | -1.25 / -16.56 | 0 |
| Classic Vinyl HD | MP3 / MP3 | 48 kHz stereo | -5.59 / -21.49 | 0 |

All three samples contained non-silent decoded audio. Radio Armisa demonstrates
that directory codec claims can disagree with the actual response. The installed
test desktop also loaded 3,278 live stations and played Classic Vinyl HD, with
platform/ICY metadata resolving. No paid fingerprint provider was configured.

The table reflects a second successful run after the late-error lifecycle fix;
the initial successful report is preserved as `live-streams-first.json`.
These are bounded point-in-time observations, not catalog-wide availability,
long-duration stability, source authenticity, perceptual fidelity, clipping
analysis over a full program, or speaker/DAC qualification. A partial compressed
sample may end mid-frame. Report: `.build/qualification/live-streams.json`.

## Windows ARM64 packaging and runtime

Live diagnostics reproduced and corrected:

1. Node 24 may call the pinned resolver with `all: true`; its callback now returns
   an array containing exactly the one approved address, while preserving the
   scalar callback contract for legacy callers. Private-address rejection remains.
   Live launch also exposed a late upstream HTTP parser error after settlement.
   Request/response error handlers now remain attached to their own emitters for
   their lifetimes; settlement is idempotent. Errors before settlement still
   reject normally. Three late-event regressions reproduced the uncaught path
   before the fix; a real malformed local HTTP response also verifies rejection
   through the promise rather than an uncaught main-process exception.
2. A sandboxed Electron `file://` GET may omit Origin. The main process asserts
   `Origin: null` only for its owned webContents, exact trusted file document and
   per-launch loopback capability API. Existing Origin headers are unchanged.
   The server still rejects originless raw clients.
3. The new compressor can apply an ARM64 filter unsupported by the bundled NSIS
   decoder. The original installer returned success while omitting the executable
   and eight DLLs. The Windows build hook now forces the supported BCJ filter.
   Both targets use 7z because the builder shares their archive cache; mixing a
   ZIP installer with a 7z portable target produced an incompatible portable.
4. Setup and Portable now have distinct artifact names and cannot overwrite each
   other in one build. Full-installer upgrades are used; differential packages
   are disabled. Neither the 7z/ARM64 failure nor a tiny empty ZIP-portable stub
   from the investigation is a qualified artifact.

`npm run test:desktop-renderer` runs a real sandboxed, context-isolated file
renderer with the production proxy in an isolated profile. Missing Origin is
rejected before the hook, the owned renderer succeeds after the hook, and a raw
originless client remains HTTP 403. It makes no station/provider requests.

The installer lab uses the distinct identity
`com.protonmatter.earthradio.qualification`, product/profile **Earth Radio
Qualification**, and a path under `.build/qualification/upgrade-lab/`. It does not
upgrade or uninstall the user's original installed Earth Radio. ZIP-based lab
versions 0.24.1 and 0.24.2 installed/launched and preserved volume 0.55 across an
actual in-place upgrade; all 18 top-level runtime files matched the unpacked
payload by SHA-256.

Final common-7z BCJ lab version **0.24.4** then passed these checks:

- Upgraded the existing lab installation with exit 0 and version 0.24.4 in the
  uninstall registration. All 18 top-level runtime files matched its unpacked
  payload. The UI retained volume 0.55, refreshed 3,278 stations **from live**,
  played Classic Vinyl HD and resolved Icecast/ICY track metadata. The final
  interactive launch's stderr log was empty.
- The portable SFX extracted to its temporary directory and opened the sandboxed
  application with the cached directory and the same separate profile/volume.
  After closing it, its temporary directory was removed by the launcher.
- Silent uninstall removed the lab executable and its registration. A subsequent
  clean install returned 0 and matched **all 86 lab payload files** by SHA-256.
  A second uninstall again cleared the executable and registration. The separate
  lab profile was preserved; the original installed Earth Radio remains present.
- Silent uninstall completion was checked for up to 30 seconds after the parent
  process returned, since the uninstaller can spawn another process. Parent exit
  alone is insufficient evidence of removal.

Reports under `.build/qualification/`: `install-bcj-final.json`,
`install-clean-uninstall.json`, `installed-visible.stderr.log` and
`installed-final.png`. These are an isolated application-identity experiment,
not a destructive upgrade of the user's existing production profile.

The root candidate was also built using the final packaging configuration under
`.build/qualification/release-candidate/`. Its portable archive reports
`LZMA2:26 BCJ`; all **87 extracted root payload files** matched its unpacked
application. These unsigned, local artifacts are not published releases:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `EarthRadio-Setup-0.24.0-recovered.1-arm64.exe` | 97,858,037 | `d2617e1e21ccb80d0e4783ba356a254aeecb762b1a9aebad25ae94121f0c81d2` |
| `EarthRadio-Portable-0.24.0-recovered.1-arm64.exe` | 97,556,793 | `27cccf4144131c0bc9d2acd178ad6167ff167d07d5331bb5347bfbf290db0291` |

The root production identity was not installed or launched against the original
user profile. Report: `.build/qualification/desktop-artifacts.json`.

No code-signing certificate was available in the user/machine certificate stores
or configured conventional signing environment variables. Generated artifacts
are **NotSigned**, regardless of the builder's generic “signing with signtool”
log messages. Trusted signing, timestamp verification, SmartScreen reputation,
real existing-production-profile migration, x64 Windows, macOS signing/notarization
and Linux installation remain outside this result.

## Icon and PWA

ChatGPT generated the new master icon. [Icon provenance](branding/ICON.md) records
the exact prompt, SHA-256 and derivative sizes. Versioned PNGs supply the header,
favicon, Apple touch and PWA icons; the ICO supplies Windows resources. Worker
generation v48 precaches the PNGs and handles branding/manifest requests offline.
Behavioral regressions first reproduced missing fetch interception and then
passed after routing those requests through the existing fallback.

The user has an iPhone/iPad available and reported successful **Add to Home Screen**
installation and good general use of the initial v48 preview. Device/iOS version,
explicit standalone-controls observation, rotation, audio after screen lock/background,
interruptions and icon masking were not separately reported. Desktop viewport
emulation and a cached-shell smoke do not supply those missing physical results.
The user initially reported seeing the old page on the physical device; no device/iOS or
playback/background result was returned. A fresh public fetch confirms worker
`earth-radio-shell-v46-atlas-lock-1` and `Cache-Control: no-cache`, whereas the
local candidate is v48. The deployment itself is older; the observation alone
does not establish a stale device cache. The public deployment still carries its
previous icon and atlas. Do not clear the user's website data to conceal this
deployment difference. The separate approved preview above now supplies a fresh
HTTPS origin for the candidate. Physical device results against it remain pending.

A browser smoke of the actual local candidate confirmed v48 active/controlling.
With HTTP cache disabled and tab networking emulated offline, the page reloaded
3,275 cached stations, all 127 land features, and the new header PNG with natural
dimensions 192 × 192. Networking and normal cache behavior were restored after
the check. This is offline-shell evidence, not installed-PWA qualification.

## Automated validation

- `npm run verify`: passed, **365 Node tests passed / 1 Windows symlink-policy
  skip**, plus metadata/desktop proxy smokes, lint, syntax and repository checks.
- `npm run test:e2e -- --workers=2`: **43 passed**, fixture-based Chromium flows.
- `npm run test:rendered`: **41 scenarios**, all assertions passed; no unavailable
  renderer skip or scenario error. Standalone scenarios emulate layout only.
- `npm run test:desktop-renderer`: passed against the real sandboxed file renderer
  and production loopback proxy, without external station/provider requests.
- Staged-site checks: **44 source files / 45 staged files**, 35 references.
- Independent focused reviews closed the branding offline-cache P2 and found no
  further actionable P0–P2 defect in the reviewed packaging/Origin/DNS/lifecycle
  changes. This does not establish a security certification.

## Release procedure and rollback

1. Resolve the failed edge gate and pending identity/device/signing gates above.
2. Run `npm run release:manifest`, `npm run verify`,
   `npm run test:desktop-renderer`, `npm run test:e2e -- --workers=2`,
   `npm run test:rendered` and `git diff --check` on the final candidate.
3. Build with `node node_modules/electron-builder/cli.js --win --arm64 --publish never`.
   Check both distinct output files, their full payload hashes, Authenticode
   status, launch, clean install, state-preserving upgrade and uninstall. A build
   exit code alone is insufficient.
4. Commit/push/deploy only with separate user authorization. Recheck the deployed
   commit, live auth, edge limits and real-device behavior after deployment.

Rollback local source changes selectively; preserve the pre-existing working
tree. Qualification artifacts are ignored under `.build/`; they are not releases.
Uninstall only the lab identity when cleaning up. Preserve its separate profile
until upgrade evidence is no longer needed. The original installed application
and profile were left intact. Production rollback uses the previous known-good
Pages deployment; no production code deployment occurred here. Re-pausing the
restored Supabase project would disable auth again and requires an explicit
   operational decision, not automatic cleanup.

## Exact working-tree file inventory

This includes the earlier discovery/atlas upgrade and this qualification follow-up.
Generated executables, profiles, raw diagnostics and screenshots remain ignored under `.build/`.

```text
 M README.md
 M RELEASE_MANIFEST.json
 M docs/ARCHITECTURE.md
 M docs/BUILD_STATE.md
 M docs/CLOUDFLARE_DEPLOYMENT.md
 M docs/OPERATIONS.md
 M docs/provenance/hardening-overlays.json
 M electron-builder.yml
 M electron/main.mjs
 M electron/proxy-rules.mjs
 M package.json
 M scripts/validate-site.mjs
 M server/net-guard.mjs
 M sha256sums.txt
 M site/_headers
 D site/assets/index-690938fe.js
 M site/assets/pinned-stations.js
 M site/assets/responsive-ui.js
 M site/index.html
 M site/manifest.webmanifest
 M site/sw.js
 M src-recovered/main.ts
 M src-recovered/ui/map.ts
 M tests/browser/harness-main.mjs
 M tests/browser/harness.mjs
 M tests/browser/scenarios.mjs
 M tests/e2e/app.spec.mjs
 M tests/e2e/reliability.spec.mjs
 M tests/e2e/web-nowplaying.spec.mjs
 M tests/live-metadata.test.mjs
 M tests/net-guard.test.mjs
 M tests/rendered-ui.test.mjs
 M tests/responsive-ui.test.mjs
 M tests/service-worker.test.mjs
 M tests/smoke-metadata.mjs
 M tests/validate-site.test.mjs
 M tests/workflow.test.mjs
?? docs/DISCOVERY.md
?? docs/HANDOFF-2026-11-03.md
?? docs/MAP_DATA.md
?? docs/QUALIFICATION-2026-11-03.md
?? docs/branding/ICON.md
?? docs/branding/earth-radio-icon-master.png
?? docs/superpowers/plans/2026-11-03-discovery-atlas.md
?? scripts/desktop-package-compat.mjs
?? scripts/fingerprint-runtime.mjs
?? scripts/qualify-live-streams.mjs
?? site/assets/discovery-core.js
?? site/assets/discovery-ui.js
?? site/assets/discovery.css
?? site/assets/index-597f6388.js
?? site/assets/map-directory.js
?? site/assets/vector-atlas.js
?? site/assets/world-land.js
?? site/branding/earth-radio-180-v2.png
?? site/branding/earth-radio-192-v2.png
?? site/branding/earth-radio-32-v2.png
?? site/branding/earth-radio-512-v2.png
?? site/branding/earth-radio-v2.ico
?? tests/discovery-core.test.mjs
?? tests/e2e/discovery.spec.mjs
?? tests/fingerprint-runtime.test.mjs
?? tests/smoke-desktop-renderer.mjs
```
