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
public Internet boundary, so a hostname that resolves to this zone (or a same-zone
redirect target) can never short-circuit to the zone origin. It complements — and must
never be treated as replaced by — the manual per-hop redirect revalidation in
`functions/_shared/guarded-fetch.js`.

- `scripts/validate-repository.mjs` (run by `npm run check` and CI) rejects a commit
  that drops the flag or introduces `global_fetch_private_origin`.
- After the first deployment carrying `wrangler.jsonc`, confirm in the dashboard that
  the flag is active for **both production and preview** environments
  (Settings → Functions → Compatibility flags), because dashboard-set values override
  nothing silently — a mismatch means the file was not picked up.

## WAF rate limiting (required, single source of rate policy)

Create zone-level rate-limiting rules exactly as follows:

| Path | Threshold | Action |
| --- | --- | --- |
| `/api/nowplaying` | 30 requests per source IP per 60 seconds | Block with HTTP 429 for 60 seconds |
| `/api/track/fingerprint` | 6 requests per source IP per 60 seconds | Block with HTTP 429 for 60 seconds |

These rules fire before the Function executes, so denied requests consume no Function
invocation and trigger no outbound fetch. They are the **only** durable rate policy:

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
3. A loopback/private/same-zone URL returns HTTP 400 with no outbound fetch in the
   Function logs.
4. Exercise each route past its threshold from one IP; record the HTTP 429 responses
   and confirm in Cloudflare analytics that WAF-denied requests did not invoke the
   Pages Function.

Record the evidence (deployment ID, flag screenshot or API read-back, 429 traces) in
`docs/BUILD_STATE.md`. **A pull request that changes the Functions is not merge-ready
until this validation has been performed on a deployment of its head commit**; without
Cloudflare account access, mark the PR blocked instead.

## Rollback

See `docs/OPERATIONS.md` — rollback is a Pages deployment operation (select the last
known-good deployment), never a Git history rewrite.
