# PR #6 Review Remediation Design

**Status:** Approved in chat on 2026-08-25

**Target:** `Protonmatter/earth-radio` pull request #6, branch `claude/icy-metadata-radio-broadcasts-9ydp14`

**Objective:** Preserve every feature introduced by PR #6 while closing all 14 unresolved review threads, represented by 12 unique defects, and produce sufficient automated and independent-review evidence for a safe merge decision.

## Constraints

- Preserve live platform metadata, HLS timed metadata, public-web and desktop fingerprinting, storage recovery, localization previews, and dynamic country expansion.
- Reject private, loopback, link-local, reserved, same-zone, or otherwise disallowed request targets before any outbound request.
- Revalidate every redirect target; the initial URL check is not authorization for later hops.
- Bound redirect count, response bytes, subrequest count, and total wall-clock time independently of socket activity.
- Never infer data loss solely from empty application data.
- Keep keyboard and pointer behavior equivalent.
- Add a failing regression before each production change and retain the regression in the repository.
- Do not resolve a GitHub thread until its exact failure mode passes locally and in CI.

## Finding Inventory and Disposition

| Group | Review defect | Required disposition |
|---|---|---|
| Edge request security | Pages Functions follow attacker-controlled redirects after checking only the initial hostname; same-zone and DNS/redirect trust boundaries are not sufficiently constrained | Fix at a shared Pages outbound-request boundary; enable strict-public fetch routing; add per-route abuse controls and redirect/private-target regressions |
| Node request security and compatibility | Desktop fingerprinting rejects ordinary public redirects, while an unsafe implementation could bypass public-target checks | Follow redirects manually through the existing DNS-aware public-target resolver, cap hops, and reject private redirect destinations |
| Request lifetime | Activity-based socket timeouts allow trickle responses to pin a request indefinitely | Add an independent wall-clock abort deadline and settle-once cleanup |
| Request identity | Playlist fetches lost the Earth Radio user agent during helper extraction | Restore a deterministic user agent at the shared outbound boundary unless explicitly overridden |
| HLS browser source | MediaSource changes `currentSrc` to `blob:`, hiding the selected HTTP(S) HLS URL | Track and prefer the selected station's original stream URL while permitting safe HTTP(S) media-element fallback |
| HLS Pages fingerprinting | Pages fingerprinting rejects HLS playlists instead of sampling media segments | Resolve master/media playlists, select a bounded recent public segment, and sample through the guarded request boundary |
| Resolver time budget | Sequential generic probes plus ICY fallback exceed the browser client's abort timeout | Use one propagated deadline, parallelize independent probes where safe, and reserve budget for the ICY fallback |
| Storage semantics | Empty IndexedDB data is treated as eviction and stale backups resurrect intentional deletions | Add an explicit monotonic generation/intent marker to primary and backup state; restore only when primary loss is proven |
| Locale preview | The document observer immediately restores the persisted locale during an unsaved preview | Track the active preview locale and make the observer enforce that effective locale until save or cancel |
| Keyboard expansion | Country expansion is wired to pointer clicks, not the country-selection action | Emit or call one semantic country-selected path for mouse, keyboard, map, and filter interactions |
| Expansion concurrency | Different country refreshes run concurrently and stale completion can overwrite the latest country set | Coalesce country codes and serialize refreshes; every refresh reads the latest persisted set immediately before fetch |
| Country cache identity | Fingerprint response cache omits normalized country despite country-specific enrichment | Include normalized country in the final-response cache key and prove countries do not share entries |

Duplicate review comments for storage semantics and the country cache will be closed by the same corresponding code change and regression.

## Architecture

### 1. Bounded outbound request layers

Node and Cloudflare remain separate runtime implementations but enforce the same contract:

```text
untrusted URL
  -> parse and scheme/credential validation
  -> target policy validation
  -> bounded request with redirect: manual
  -> validate Location against the current URL
  -> repeat up to the hop cap
  -> content-type and byte-limit validation
  -> caller-specific parsing
```

The Node implementation extends `server/net-guard.mjs`. It continues to resolve DNS and reject any address outside the public policy before each hop. A single absolute deadline is calculated once and passed through redirects, playlist requests, and segment sampling. A dedicated timer destroys the active request even if bytes continue arriving. Completion, timeout, size-limit, abort, and socket-error paths share one settle-once cleanup function.

The Pages implementation uses a repository-local helper under `functions/_shared/` and always calls `fetch` with `redirect: 'manual'`. It rejects literal non-public targets and same-zone destinations, resolves relative `Location` values against the current URL, revalidates each hop, and enforces the same hop/subrequest/byte/deadline caps. Cloudflare's `global_fetch_strictly_public` compatibility flag is mandatory so global `fetch()` routes through the public Internet boundary instead of privately reaching a zone origin. Cloudflare documents that this flag changes global-fetch routing, and Pages supports compatibility flags through project configuration.

Abuse protection is defense in depth, not a replacement for SSRF controls. The production zone must enforce Cloudflare WAF rate-limiting rules before the Function executes: `/api/nowplaying` permits 30 requests per source IP per 60 seconds and `/api/track/fingerprint` permits 6 requests per source IP per 60 seconds; excess requests receive HTTP 429 for 60 seconds. The deployment runbook records these exact rules, and preview validation proves that rate-limited requests do not invoke an outbound fetch. No secret or credential is stored in repository configuration.

### 2. HLS and metadata flow

The browser metadata overlay stores the selected station's canonical HTTP(S) stream URL separately from the media element. It uses that value for platform polling and fingerprint requests when `currentSrc` is a MediaSource `blob:` URL. A non-blob HTTP(S) `currentSrc` remains a valid fallback.

Both fingerprint runtimes use the guarded request layer. For HLS, they:

1. fetch a bounded playlist;
2. resolve a master playlist to one public variant using deterministic selection;
3. fetch the media playlist within the same absolute deadline;
4. select a bounded set of recent media segments;
5. revalidate and fetch segments through the same redirect guard;
6. stop when the audio sample cap is reached.

Platform resolution shares one deadline across platform-specific, generic Icecast/Shoutcast, and ICY stages. Independent generic status probes may run concurrently, but cancellation and the remaining budget are propagated so the ICY fallback starts while usable time remains.

### 3. Storage recovery protocol

The storage guard records a versioned envelope rather than judging record contents:

```text
{
  schemaVersion,
  generation,
  committedAt,
  data,
  checksum
}
```

The primary store carries the current generation marker. Every intentional snapshot, including an empty state, advances the generation and writes a checksummed backup. Recovery occurs only when the primary generation marker is missing or invalid and a valid backup exists. A valid primary marker with empty data is authoritative and must never be overwritten. Restore writes the backup data and its generation in one IndexedDB `readwrite` transaction over the existing `kv` object store, then preserves the existing guarded reload limit.

This protocol must compose with account-scoped data if PR #7 lands first: backup identity includes the active account namespace, and no backup from one account may restore into another account's working keys.

### 4. Browser state consistency

- Locale preview introduces an explicit `previewLocale`. The effective locale is `previewLocale ?? persistedLocale`. The mutation observer enforces the effective locale; Save persists and clears the preview, while Cancel clears the preview and reapplies the persisted locale.
- Country expansion uses one semantic selection function/event, not DOM click inference. Map, picker mouse selection, picker keyboard selection, and filter selection all call the same expansion path.
- Expansion requests use one serialized/coalescing scheduler. New ISO codes are added to the pending set while a refresh runs. Before each fetch, the scheduler snapshots the latest persisted code set. If new codes arrive during a fetch, it performs one subsequent refresh; stale results never become the terminal state.
- Fingerprint cache keys use the normalized two-letter country plus normalized stream URL. Invalid or absent countries map to one explicit default key.

## Error Handling

- Invalid initial or redirect target: return the existing safe client error class without disclosing internal addresses.
- Redirect loop or hop exhaustion: deterministic bounded error.
- Absolute deadline: abort all active work, clear timers/listeners, and return the existing timeout status.
- Byte/subrequest limit: stop immediately and do not cache partial results.
- Rate limit: return HTTP 429 with `Retry-After`; do not start outbound fetches.
- Invalid HLS playlist or segment response: fail fingerprinting without falling back to an unguarded fetch.
- Corrupt backup: preserve primary state, skip restore, and surface the existing diagnostic path.
- Expansion failure: retain the persisted country set and prior displayed results; allow the next serialized refresh to retry.

## Test Design

Each item starts with a regression that fails against PR head `f0bdbbd6ec78377c02edf377e40f40ce6dcce433` for the intended reason.

### Security and networking

- Public URL redirecting to loopback/private/same-zone is rejected before the second request.
- Relative redirects are resolved and revalidated; redirect loops and hop overflow are rejected.
- A public redirect to a public audio target succeeds in Node fingerprint sampling.
- Trickle traffic cannot extend the absolute deadline.
- Playlist, HLS variant, and segment requests include the Earth Radio user agent.
- Production WAF validation returns 429 at the specified thresholds and Function invocation logs show no outbound fetch for denied requests.
- Alternate malicious forms cover IPv6 loopback, IPv4-mapped IPv6, integer/encoded IPv4 where URL parsing accepts it, credentials, and scheme changes.

### HLS and metadata

- Blob playback retains the selected HLS HTTP(S) URL for polling and fingerprinting.
- Pages fingerprinting resolves a master playlist and samples a media segment.
- HLS redirect chains apply the same public-target policy as raw audio.
- Slow generic probes still leave budget for a successful ICY fallback.

### Browser state and data

- Intentional clearing of the final favorite remains empty after reload.
- Missing/corrupt primary generation restores a valid backup.
- Account A backup cannot restore under Account B when account namespaces exist.
- Arabic preview retains `lang`, `dir`, and font until Save or Cancel.
- Enter-key country selection triggers expansion exactly as pointer selection does.
- Japan then Brazil during one in-flight refresh produces a final fetch/result containing both.
- US and KR fingerprint responses use distinct cache entries.

### Required verification

1. Focused tests for each changed subsystem.
2. `npm run check` and `npm test`.
3. `npm run verify`.
4. `npm run test:e2e` with all existing Playwright scenarios plus new regressions.
5. Staged-site and deterministic release-manifest/provenance verification.
6. GitHub CI on Ubuntu, Windows, and Playwright at the exact final head.
7. Independent code review of the complete final diff.
8. Independent security review of the URL-fetch boundary and storage account isolation.

## GitHub Review and Merge Gate

For each thread, the reply will name the fix and its regression. Threads are resolved only after the final-head CI run is green. The PR is merge-ready only when:

- GitHub reports it mergeable;
- all 14 review threads are resolved;
- no Critical or Important issue remains in the independent final review;
- the security re-review reports no surviving SSRF, redirect-policy, rate-limit-bypass, or cross-account restoration path;
- all required checks complete successfully at the exact final commit;
- any required Cloudflare compatibility/rate-limit configuration is applied or represented by deployable repository configuration and validated in preview.

## Authoritative Platform References

- Cloudflare Workers compatibility flags: https://developers.cloudflare.com/workers/configuration/compatibility-flags/
- Cloudflare Pages Functions configuration: https://developers.cloudflare.com/pages/functions/wrangler-configuration/
- Cloudflare Workers Rate Limiting API: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
