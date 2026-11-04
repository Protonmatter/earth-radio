# Earth Radio 0.25.0 release record

Release date: 2026-11-03 (America/New_York). This record follows the user's explicit
request to resolve the remaining blockers, rebuild desktop with the latest map
changes, and publish production. The user confirmed the corrected physical-device
map works. Earlier preview evidence remains in QUALIFICATION-2026-11-03.md.

## Changes

- The discovery/selection upgrade, bundled atlas, world mapped-directory correction
  and ChatGPT-generated icon are included in this release.
- A private SQLite Durable Object replaces the unavailable zone-WAF rate control.
  It enforces rolling per-client budgets of 30 now-playing and 6 fingerprint
  requests/minute, with non-extending 60-second mitigation, before metadata work.
  Production/preview scope is deployment-bound, so immutable production aliases
  share its budget. Missing/failed quota control returns 503.
- Counter storage contains only bounded accepted-time queues and timestamps; keys
  hash scope plus Cloudflare's canonical client address. Alarms clear idle rows and
  delete empty storage. Privacy disclosure describes the operational counters.
- The application/package version is 0.25.0; shell generation is v51.

## Signing decision

No existing signing certificate or service was configured. The user requested a
certificate, then explicitly chose **local signing only for now** instead of paid
public-trust enrollment. A self-signed RSA-3072/SHA-256 code-signing certificate was
created in CurrentUser/My with a non-exportable Windows-managed private key.
Only its public certificate was exported under ignored `.build/qualification/`.
Neither Windows Trusted Root store was changed.

Desktop artifacts use SHA-256 Authenticode signatures and DigiCert RFC3161
timestamps. Windows reports an untrusted self-signed root; this is an accepted
local-build limitation, not public publisher trust or SmartScreen qualification.
The certificate's public subject is `CN=Earth Radio Local Build`; its fingerprint
and expiry are recorded with the ignored signing evidence. Never export or commit
the private key, import the certificate into Root automatically, or describe this
build as publicly trusted.

## Edge architecture and evidence

Private Worker: `earth-radio-metadata-limits`, class `MetadataRateLimit`.
Initial version: `904c1b7b-14ed-442a-a1e1-da4392d63b1b`. The Worker did not exist
before provisioning; migration v1 therefore created a fresh SQLite namespace.
Public Worker and preview URLs are disabled. No plan upgrade, recognition secret,
new analytics collection, or project dependency was added.

The existing Cloudflare CLI received the user-approved Workers Scripts Write
scope alongside Pages Write and account/user read. Credentials remain encrypted
through Windows Credential Manager. No OAuth token is recorded in this repository.

Local real-runtime checks used the CLI's installed Miniflare/workerd, which supports
compatibility date 2026-09-18. The deployed Worker targets 2026-11-03; remote preview
qualification is required in addition to that bounded local evidence.
`scripts/qualify-edge-runtime.mjs` verified concurrent exact budgets, independent
clients, persisted denial after runtime restart, independent kind expiry, complete
storage deletion and fresh concurrent requests after cleanup. Pure regressions
cover rolling boundaries, clock rollback, identity/scope, fail-closed behavior,
encoded routes and required bindings. Independent review found no remaining code
P0–P2 issue after cleanup and rolling-window corrections.

The middleware still incurs Pages/DO invocation costs for denied requests. It
prevents station/provider work, not an invocation-volume attack. Older immutable
deployments predating middleware are separate artifacts. Paid recognition remains
disabled; do not silently enable it on historical unguarded deployments.

## Qualification and publication

Published production: <https://earth-radio.pages.dev/>. Deployment
`77a8499e-e8ed-4ae8-a047-4a362306eb86` is **Production**, branch `main`, immutable
URL <https://77a8499e.earth-radio.pages.dev/>. It replaced deployment
`f9631de3-21e5-4080-8d66-ed74c0577373` (v46). Immediately before publication, the
old production HTML/SW hashes still matched the recorded baseline.

The release preview was <https://qualification-release-0-25-0.earth-radio.pages.dev/>,
deployment `c62830df-b727-4f94-91f9-ef8b30059ae6`, immutable URL
<https://c62830df.earth-radio.pages.dev/>. Preview and production upload commands
used the existing Wrangler 4.131.1 installation, staged `.build/site` and
`--commit-dirty=true`. Production used `--branch main`. Both compiled/uploaded the
current Functions and applied the private namespace binding and explicit scope.

Remote preview and production qualification each verified:

- All **45 public files**, including `asset-manifest.json`, match staged size and
  SHA-256. `_headers` is configuration, not a public asset. Shell CSP/HSTS are present.
- A concurrent empty-probe burst accepted exactly **30 of 32** now-playing requests
  and **6 of 8** fingerprint requests; each excess returned **429**, no-store and
  Retry-After within 60 seconds. Empty probes do not fetch a stream or invoke a
  recognition provider.
- The immutable and stable aliases, encoded endpoint spelling, trailing slash and
  forged X-Forwarded-For did not create another budget. Preview was exhausted just
  before production's burst; production still retained its complete budget.
- Both probe endpoints recovered to 200 after mitigation. Fingerprinting reports
  `available:false` and an empty provider list; paid providers remain unconfigured.

Production browser smoke used the real directory and stream: world area search
populated **10,000 mapped stations**, the actual controlling service worker had
only `earth-radio-shell-v51-release-0-25-0` in CacheStorage, and the existing account
displayed **GitHub linked / Synced**. Previous independently completed Google and
GitHub return-flow evidence remains in the qualification record; the current
session alone does not re-prove those OAuth flows or identity unification.
Classic Vinyl HD audio advanced to **36.21 seconds**, `readyState:4`, with no audio
error, and was explicitly paused after the smoke. This is point-in-time playback
evidence, not an audio-fidelity certification or guarantee for every station.

At **390 × 844**, the production atlas showed **9,761 stations** in the visible
world rectangle after Search this area; document and scroll widths both measured
390. Browser sizing was restored. The production tab had no captured warning/error
console entries during this smoke. These are desktop browser viewport measurements,
separate from the user's physical installed-PWA report.

Bounded observations span **01:45:47–02:01:17 UTC on 2026-11-04** (the evening of
November 3 locally), approximately 15½ minutes after initial publication checks.
The later scheduled observation series completed seven samples / 28 requests:
HTML and service-worker hashes remained correct and both API probes returned 200
in every sample. The final Cloudflare list still identified the same Production
deployment. This is an observed smoke window, not fleet telemetry, a load test,
or a long-term availability/error-rate claim. The bounded observer exited.
Live `/api/nowplaying` additionally rejected loopback and same-origin inputs with
400, and returned actual ICY artist/title metadata for the public Classic stream.

### Final ARM64 desktop artifacts

Artifacts are under ignored `.build/qualification/desktop-0.25.0-final/`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `EarthRadio-Setup-0.25.0-arm64.exe` | 97,887,528 | `6ca1a5e578f18658acd1fbde611c100fbd94c7a3b0547cc75a00b60633b990a6` |
| `EarthRadio-Portable-0.25.0-arm64.exe` | 97,580,072 | `171fb7ef54b91fb00ebda26684a0771800cce4dac6e053e0a47eb441a2184a36` |

Both artifacts and the packaged app executable identify version 0.25.0 and carry
the selected local signer plus DigiCert timestamp. `Get-AuthenticodeSignature`
reports `UnknownError` because its chain terminates at the untrusted local root;
the certificate is absent from both Root stores. Do not bypass Windows warnings
or add trust automatically. Signing configuration stays outside tracked source.

All **59 packaged application files** under site/electron/server match current
source bytes. Both root setup and portable archives' **87 extracted payload files**
match the signed unpacked build. The final root portable was launched with an isolated user-data
directory; its real non-German map area populated **873 stations** and Classic
Vinyl HD reached its live station metadata/feed. It exited and removed its
temporary extraction directory.

Installer qualification used the separate **Earth Radio Qualification** identity.
The final test upgraded 0.24.4 → 0.25.0 with exit 0, registered version 0.25.0 and
preserved the saved station plus 55% volume. A separate clean 0.25.0 installation
returned 0 and matched all **86 expected installed payload files**. Final uninstall
returned 0 and removed the executable/registration, preserving the lab profile.
An initial lab fixture omitted its existing productName metadata and opened a
different profile; that fixture was corrected and the preservation test repeated.
The actual Earth Radio identity was already consistent with the installed 0.24.0
package. The original application/profile was not upgraded or used for this test.

### Validation commands

- `npm run release:manifest` and `npm run verify`: passed; **386 Node tests**,
  one Windows symlink-creation-policy skip, metadata/desktop proxy smokes, lint,
  repository safety/syntax, staging, both site validations and deterministic hashes.
- `npm run test:e2e -- --workers=2`: **49 passed**. Browser fixtures establish
  application behavior, while the separate live checks above establish bounded
  production behavior.
- `npm run test:rendered`: passed all **41 rendered scenarios** without a skip.
- `npm run test:desktop-renderer`: passed actual sandbox/context-isolation checks;
  the owned file renderer is accepted while a raw client without Origin is rejected.
- `node scripts/qualify-edge-runtime.mjs --wrangler <existing-cli-path> --compatibility-date 2026-09-18`:
  passed real SQLite/RPC persistence/concurrency/cleanup checks. The remote preview
  above additionally exercised the production Worker's 2026-11-03 compatibility date.
- `npx --no-install electron-builder --win --arm64 --config <ignored-local-signing-config> --publish never`:
  produced the final setup and portable; local signature inspection, source/payload
  hashes, real portable launch, isolated clean install/upgrade/uninstall passed.

Ignored evidence includes `production-0.25.0-http.json`, `release-preview-http.json`,
`release-preview-assets.json`, `preview-isolation-at-production.json`,
`production-0.25.0-recovery.json`, `deployments-production-0.25.0.json`,
`desktop-0.25.0-artifacts.json`, `desktop-0.25.0-payload.json`,
`portable-0.25.0-payload.json`, `desktop-0.25.0-upgrade.json`,
`setup-0.25.0-payload.json`, `upgrade-profile-0.25.0.json`,
`desktop-0.25.0-clean-install.json`, `production-0.25.0-browser.json`,
`production-0.25.0-metadata.json`, `production-0.25.0-observation.json`,
`deployments-production-final.json` and build/check logs.

The initial production publication was a direct working-tree upload, with no
source commit/push authorized at that time. Its deployed source label is `81c5e59`
plus the recorded working-tree changes; that label alone cannot reproduce the
uploaded bytes. The user subsequently authorized committing and pushing all release
changes, passing CI, and merging into main. This release source delivers the same
qualified runtime/configuration through that pull-request workflow. GitHub's checks
on the release pull request and resulting main commit are the authoritative CI
records. After merge, verify the Git-triggered production deployment and public
asset hashes against the qualified artifact. No automatic-build setting is changed.

## Rollback

Follow CLOUDFLARE_DEPLOYMENT.md. For a UI-only rollback deploy a preserved static
artifact with the current guarded Functions/bindings. Do not restore an unguarded
old deployment as the default rollback, remove the quota binding, or delete the
namespace. Repair a failed quota service while keeping its 503 behavior. Preserve
the original desktop installation/profile; installer qualification uses a separate
Earth Radio Qualification identity. Local signing remains a user-selected trust
exception.

## Remaining qualification boundaries

Publicly trusted desktop signing is deferred by user decision. Physical device
model/OS and explicit screen-lock/interruption audio results remain unreported;
the user's installed-PWA and corrected-map reports are recorded without inventing
those details. The recovered TypeScript snapshot still does not rebuild the
selected runtime by itself. No external CI result is implied by local checks.
Supabase's intentional SECURITY DEFINER RPC warning was reviewed previously;
leaked-password protection remains disabled. The app offers OAuth/magic-link
sign-in rather than password entry, and that password hardening option requires
Supabase Pro or above; no paid upgrade or unrelated auth-policy change occurred.
