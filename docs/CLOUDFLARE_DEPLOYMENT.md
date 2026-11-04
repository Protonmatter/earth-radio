# Cloudflare Pages Deployment

This document is the authoritative procedure for deploying the Earth Radio public web
app (static site + `/api/*` Pages Functions) and for the external edge controls that
the in-repository code assumes exist. The Functions fetch listener-supplied stream
URLs, so two controls are **mandatory before production traffic**: strict-public
fetch routing and the private durable quota service described below.

The earlier zone-WAF design failed qualification because this `pages.dev` project
has no controlled zone. Release 0.25.0 replaces that missing control with Pages
middleware backed by a private SQLite Durable Object Worker. Denied requests
consume a Pages/DO invocation, but must not perform station fetching, sampling
or recognition. This does not provide WAF-level protection against invocation
volume costs. Historical results remain in the [qualification record](QUALIFICATION-2026-11-03.md).

## Project configuration

`wrangler.jsonc` at the repository root is the deployable configuration:

- `name`: `earth-radio`
- `pages_build_output_dir`: `.build/site` — the staged, validated artifact produced by
  `npm run build:web` (`scripts/stage-site.mjs`) and checked by `npm run verify:site`.
  The remediation plan sketched `./site`; the raw `site/` source is deliberately not
  deployed because staging is where site validation and deterministic manifests run
  (see `docs/OPERATIONS.md`). Functions are always uploaded from the repository-root
  `functions/` directory regardless of the output directory.
- `compatibility_flags`: must include `global_fetch_strictly_public`.

Pages dashboard build settings (mirrors `docs/OPERATIONS.md`):

```text
Production branch: main
Build command: npm ci && npm run build:web
Output directory: .build/site
Node: 24.18.0
```

## Strict public fetch routing (required)

`global_fetch_strictly_public` forces the Workers-runtime global `fetch()` through the
public Internet boundary and prevents fetches from reaching private-network origins.
Workers cannot perform the desktop boundary's DNS resolution and connection pinning,
so this deployment flag is a required part of the public-target boundary. It complements
— and must never be treated as replaced by — the manual per-hop redirect revalidation
and explicit same-zone checks in `functions/_shared/guarded-fetch.js`.

- `scripts/validate-repository.mjs` (run by `npm run check` and CI) rejects a commit
  that drops the flag or introduces `global_fetch_private_origin`.
- After the first deployment carrying `wrangler.jsonc`, confirm in the dashboard that
  the flag is active for **both production and preview** environments
  (Settings → Functions → Compatibility flags), because dashboard-set values override
  nothing silently — a mismatch means the file was not picked up.

## Listener-controlled fetch boundary

Both Functions pass `new URL(request.url).origin` as a forbidden origin. Before the
initial fetch and before every redirect hop, the shared guard:

- accepts only HTTP(S) URLs without embedded credentials;
- canonicalizes hostnames, alternate integer/hex IPv4, and IPv4-in-IPv6 forms;
- blocks localhost-style names, `.local`, `.internal`, `.home.arpa`, the Function's
  own zone, and literal private, loopback, link-local, unspecified, multicast, CGNAT,
  benchmarking, and documentation networks (including `192.0.2.0/24`,
  `198.51.100.0/24`, `203.0.113.0/24`, and `2001:db8::/32`);
- uses `redirect: 'manual'`, resolves relative `Location` values against the current
  URL, rejects loops or missing locations, and permits no more than four redirects;
- applies one absolute deadline to the complete redirect chain and to capped response
  body reads, cancelling bodies that are rejected, complete, or truncated.

The same-zone rule is an origin comparison, including effective default ports. A
public-looking initial URL is never authorization for a later hop: every redirect is
checked before the next `fetch()` call. `global_fetch_strictly_public` supplies the
DNS/egress enforcement that JavaScript in the Workers runtime cannot implement.

`/api/nowplaying` uses one 11-second deadline. Specific platform probes and concurrent
generic Icecast/Shoutcast probes consume only their stage slice, leaving eight seconds
for the ICY fallback. `/api/track/fingerprint` uses one 40-second deadline for the
complete stream/HLS sample, provider recognition, and optional catalog enrichment. HLS
sampling reads at most 64 KiB per playlist, follows a bounded master/media chain,
selects at most the last three coherent segments plus the applicable `EXT-X-MAP`, caps
the combined sample at 1 MiB, and allows at most 16 raw stream-controlled fetch
attempts. Provider POSTs go only to configured ACRCloud/AudD destinations and are capped
at 15 seconds or the route's remaining time, whichever is shorter.

## Durable quota service (required)

`functions/api/_middleware.js` checks the private `METADATA_LIMITS` binding before
calling either metadata handler, including probes and cache hits. The Worker is
`earth-radio-metadata-limits`, class `MetadataRateLimit`, under `workers/rate-limit/`.
Its public `workers.dev` and preview URLs are disabled. The following rolling
budgets apply to `(now - 60 seconds, now]`:

| Path | Threshold | Action |
| --- | --- | --- |
| `/api/nowplaying` | 30 requests/minute/IP | Block with HTTP 429; mitigation timeout 60 seconds |
| `/api/track/fingerprint` | 6 requests/minute/IP | Block with HTTP 429; mitigation timeout 60 seconds |

The first excess request starts a non-extending 60-second mitigation. SQLite
transactions persist at most 30/6 accepted timestamps per quota kind. One object
coordinates each scope/client hash across isolates and locations. The key uses
Cloudflare's trusted `CF-Connecting-IP`; visitor `X-Forwarded-For` is ignored.
No raw IP, account identity or stream URL is stored in the counter. Alarms remove
idle rows after two minutes and delete storage when empty. No new analytics/log
collection is enabled, following the repository's telemetry rule.

Root `wrangler.jsonc` explicitly binds both Pages environments. The non-secret
`METADATA_LIMIT_SCOPE` is `production` or `preview`; it comes from deployment
configuration, not the hostname. Thus a production deployment's immutable URL
shares the production budget, while preview traffic cannot consume it. Missing
identity, binding or scope, failed RPC, and the 3-second quota deadline return
HTTP 503 without downstream work. HTTP 429 includes `Retry-After`. Middleware
responses use `Cache-Control: no-store`.

### Deployment order

Use an already installed Wrangler and record its version. Commands below do not
commit or push source. Obtain authorization for remote changes and select the
exact account/project before running them.

```powershell
$wranglerCli = '<installed-wrangler>/bin/wrangler.js'
# Private Worker/class must exist before Pages binds to it.
node $wranglerCli deploy --config workers/rate-limit/wrangler.jsonc
npm run release:manifest
npm run verify
npm run test:e2e -- --workers=2
npm run test:rendered
node $wranglerCli pages deploy .build/site --project-name earth-radio --branch qualification-release-0-25-0 --commit-dirty=true
# Only after preview qualification and production authorization:
node $wranglerCli pages deploy .build/site --project-name earth-radio --branch main --commit-dirty=true
```

The initial migration creates a fresh SQLite namespace. Do not apply the initial
table schema over a different existing schema; use a forward migration. Do not
delete the namespace to reset a quota. Absence of the Worker was verified before
its first deployment for this release.

Optional runtime verification uses the installed tool's existing Miniflare; it
installs nothing and deploys no remote resource:

```powershell
node scripts/qualify-edge-runtime.mjs --wrangler $wranglerCli
```

If the cached engine cannot support the production date, an explicit
`--compatibility-date YYYY-MM-DD` tests only that older runtime. Record the
limitation and still qualify the real production date on the remote preview.

## Environment variables (optional)

Fingerprinting activates only when recognition credentials exist as Pages project
environment variables: `AUDD_API_TOKEN`, or `ACR_HOST` + `ACR_ACCESS_KEY` +
`ACR_ACCESS_SECRET`. Without them `/api/track/fingerprint` reports `available: false`
and performs no outbound requests. Credentials are never committed;
`scripts/validate-repository.mjs` scans for accidental assignments.

## Post-deployment validation

Run against the preview URL after every deployment that touches `functions/` or
`wrangler.jsonc`:

1. Before opening a browser (whose probes consume budget), issue 32 now-playing
   and 8 fingerprint requests without stream URLs. A fresh client/scope must allow
   exactly 30 and 6, then HTTP 429. Check Retry-After and mitigation recovery.
2. `/api/nowplaying` answers its JSON probe after budget recovery.
3. A public stream URL that redirects resolves correctly (redirects are followed
   manually with per-hop revalidation).
4. An initial loopback/private/reserved/same-zone URL returns HTTP 400 without an
   outbound fetch; a redirect to any such target stops before fetching the denied hop.
5. Verify production/preview scope separation and encoded/trailing-slash routes.
   Rejections occur before metadata/provider work; they still invoke Pages/DO.
   Unit/runtime tests cover binding/RPC failures without fault-injecting production.

Record the evidence (Worker version, Pages deployment ID, bindings and 429 traces) in
`docs/BUILD_STATE.md`. **A pull request that changes the Functions is not merge-ready
until this validation has been performed on a deployment of its head commit**; without
Cloudflare account access, mark the PR blocked instead.

## Rollback

Preserve a known-good staged static artifact and the counter Worker version. If
the UI regresses, deploy that static artifact from the current repository root so
current guarded Functions and bindings remain attached. Rolling the entire
project back to a pre-0.25 deployment restores unmetered routes and is not the safe
default. If the quota service fails, retain its 503 behavior while restoring a
compatible Worker version or fixing forward. Do not remove bindings or fail open.
Namespace data is not reverted by Worker code rollback. Historical immutable
URLs remain separate artifacts: this middleware protects deployments containing
it, not old URLs predating the gate. Keep paid recognition disabled on those builds.
