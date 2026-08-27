# Cloudflare Pages Deployment

This document is the authoritative procedure for deploying the Earth Radio public web
app (static site + `/api/*` Pages Functions) and for the external edge controls that
the in-repository code assumes exist. The Functions fetch listener-supplied stream
URLs, so two controls are **mandatory before production traffic**: the strict-public
fetch compatibility flag and the WAF rate-limit rules below.

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
for the ICY fallback. `/api/track/fingerprint` uses one 20-second deadline for the
complete stream/HLS sample, provider recognition, and optional catalog enrichment. HLS
sampling reads at most 64 KiB per playlist, follows a bounded master/media chain,
selects at most the last three coherent segments plus the applicable `EXT-X-MAP`, caps
the combined sample at 1 MiB, and allows at most 16 raw stream-controlled fetch
attempts. Provider POSTs go only to configured ACRCloud/AudD destinations and are capped
at 15 seconds or the route's remaining time, whichever is shorter.

## WAF rate limiting (required, single source of rate policy)

Create zone-level rate-limiting rules exactly as follows. Use a 60-second mitigation
timeout and an HTTP 429 response for both rules:

| Path | Threshold | Action |
| --- | --- | --- |
| `/api/nowplaying` | 30 requests/minute/IP | Block with HTTP 429; mitigation timeout 60 seconds |
| `/api/track/fingerprint` | 6 requests/minute/IP | Block with HTTP 429; mitigation timeout 60 seconds |

These rules must execute before the Function. A WAF-denied request must consume no
Function invocation and trigger no outbound fetch. They are the **only** durable rate
policy:

- `/api/track/fingerprint` (metered third-party recognition credit) carries **no**
  in-isolate counter. A per-isolate budget multiplies by however many isolates
  Cloudflare runs and would misrepresent the real limit, so the WAF rule is the single
  source of truth.
- `/api/nowplaying` keeps a best-effort in-isolate limiter purely as defense in depth;
  it must never be tuned as if it were the enforcement point.

## Environment variables (optional)

Fingerprinting activates only when recognition credentials exist as Pages project
environment variables: `AUDD_API_TOKEN`, or `ACR_HOST` + `ACR_ACCESS_KEY` +
`ACR_ACCESS_SECRET`. Without them `/api/track/fingerprint` reports `available: false`
and performs no outbound requests. Credentials are never committed;
`scripts/validate-repository.mjs` scans for accidental assignments.

## Post-deployment validation

Run against the preview URL after every deployment that touches `functions/` or
`wrangler.jsonc`:

1. `/api/nowplaying` answers the JSON probe (`ok: true`).
2. A public stream URL that redirects resolves correctly (redirects are followed
   manually with per-hop revalidation).
3. An initial loopback/private/reserved/same-zone URL returns HTTP 400 without an
   outbound fetch; a redirect to any such target stops before fetching the denied hop.
4. Exercise `/api/nowplaying` past 30 requests/minute/IP and
   `/api/track/fingerprint` past 6 requests/minute/IP; record HTTP 429 and the
   60-second mitigation window, then confirm in Cloudflare analytics that each denied
   request did not invoke the Pages Function.

Record the evidence (deployment ID, flag screenshot or API read-back, 429 traces) in
`docs/BUILD_STATE.md`. **A pull request that changes the Functions is not merge-ready
until this validation has been performed on a deployment of its head commit**; without
Cloudflare account access, mark the PR blocked instead.

## Rollback

See `docs/OPERATIONS.md` — rollback is a Pages deployment operation (select the last
known-good deployment), never a Git history rewrite.
