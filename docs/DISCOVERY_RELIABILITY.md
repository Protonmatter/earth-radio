# Directory, search and map reliability

This follow-up addresses the five high-impact findings from the November 8 review:
cold-start directory fan-out, fuzzy ranking ahead of exact matches, repetitive
initial results, missing map positions, and large install-time map downloads.
It retains the existing playback, station UUID, favorites, account and sync contracts.

## Directory boundary and refresh

Production web configuration selects `/directory/snapshot`. The Pages Function
serves a shared, same-origin Radio Browser snapshot with an ETag. Cold browser boot
uses one snapshot request; previously selected additional countries may add bounded
country requests. The snapshot contains at most 10,000 upstream records; it is a
sample, not an exhaustive global index. The live November 8 probe measured about
11.9 MB raw. HTTP compression reduces transfer size; that is not the decoded size.
Normalization and UUID deduplication remain in the client. The response is streamed
at the edge to avoid a multi-MB JSON parse/stringify under the Free-plan CPU budget.
It is not a precomputed search index or a geocoded authoritative database.

`functions/directory/[[path]].js` exposes only these finite paths:

- `/directory/snapshot`: global top-click sample, limit 10,000.
- `/directory/countries`: country index.
- `/directory/servers`: mirror names.
- `/directory/country/XX`: a two-letter uppercase country, limit 1,000.

Query strings, arbitrary destinations, other paths and write methods are rejected.
Every destination is HTTPS under a strictly validated Radio Browser API hostname;
redirects are refused. The existing `global_fetch_strictly_public` flag remains
mandatory. This is a provider-specific directory reader, not an exposed desktop
proxy. Metadata quotas, credentials, SMTP and account configuration are unchanged.
Discovery and snapshot fetches use `redirect: 'manual'` and reject non-success
responses. Workers does not implement Fetch's `error` redirect mode: that mode
caused an immediate 503 in the first live preview before any provider request.
The preview gate caught it before production; explicit compatibility and redirect
rejection regressions now cover both fetch paths.

The Cache API retains snapshots up to seven days. After one hour, a request returns
the old snapshot while starting a shared background refresh. A failed refresh keeps
the old value and starts a one-minute retry cooldown. Cold misses coalesce by key;
at most four distinct keys refresh concurrently per isolate. Responses have a
five-minute browser cache lifetime and an ETag. Network/body work has a deadline
and a 16 MiB decoded byte cap. No per-request user identity or activity is stored.
Cache eviction is possible: this is not durable snapshot storage or a scheduled
hourly job. Freshness depends on demand; stale state is identified to clients.
Cache contents are local to each Cloudflare data center; a warm response in one
region does not establish a warm cache elsewhere. The explicit `_routes.json`
invokes Functions only for `/api/*` and `/directory/*`, keeping static assets on
the existing static delivery path. The default client country limit remains 150
even though a targeted country endpoint can return up to 1,000 records.
Cache reads/writes are best effort and bounded. Writes get the full remaining
body-transfer deadline plus a cache margin, so a healthy slow snapshot can warm
the cache. Failed or stalled cache operations do not hide a valid fresh response.

Discovery uses `/json/servers`, deduplicates validated hostnames, caches the healthy
set, and temporarily deprioritizes failed hosts. Three bootstrap names remain
necessary to discover the provider in the first place. Retired nl1/at1 defaults are
removed. On November 8 those two names did not resolve; de1, de2 and all resolved
to one IP, so different names did not establish independent redundancy. Direct
fallback and desktop directory loading now fail a mirror's global request before
starting its country fan-out. The existing local IndexedDB stale fallback remains.

This uses the existing Pages/Workers Free plan and adds no R2/KV binding, new Worker,
credential, dependency, subscription or paid resource. It shares the existing free
request/CPU limits; it does not offer unlimited hosting. Durable hourly collection
would require a separately reviewed storage/scheduler design and cost decision.

## Search and opening results

Best-match ranking orders full-title equality first, then exact name tokens, name
prefixes, exact metadata vocabulary, substrings and finally fuzzy candidates.
Every term remains conjunctive. Fuzzy matching is used only when no higher-tier
result exists, and known place or genre terms cannot become unrelated fuzzy terms. Unique
genre corrections take priority over unrelated station-name typos and are disclosed
in the result status. Reliability/popularity signals break relevance ties; they
cannot promote a fuzzy result above an exact one.

Country and language aliases derive from `Intl.DisplayNames` in all six UI locales,
with retained directory/colloquial aliases and retired-code exclusions. The country
picker searches these same aliases without changing stored selection values. Natural
Earth supplies a separately derived place vocabulary so `seoul` does not become
`soul` even when Seoul is absent from the loaded sample. Empty best-match discovery
uses a bounded diversity pass, seeded with country representatives from the whole
catalog, then balances country, genre and station-family repetition. Recent views
remain chronological and explicit A–Z/bitrate sorts retain their stated behavior.

This change does not merge distinct station UUIDs or stream variants. Search can
still show separately registered KBS/FIP/BBC streams. Grouping those safely needs
a separate identity/quality-picker design that preserves favorites, links and
playback failover. Remote name-query expansion and parsed query chips are also
outside this first pass.

## Map position and download boundaries

`station-location.js` returns a presentation position separate from raw directory
coordinates. Valid positions use the directory point. Missing or clearly implausible
points use a pinned Natural Earth country reference point and carry `approximate`.
Country polygon-component envelopes with one-degree coastal tolerance reject
obvious country/ocean mismatches; they do not prove the station's real transmitter
location. Unknown country codes remain unlocated. Approximate markers are dashed,
tooltips disclose country-level location, and map counts separate precise,
approximate and unlocated records. No invented coordinates enter account documents,
quality scores or geographic-search data. The initial map excludes most Antarctica;
stations remain available in the list.

Derived country references and 7,084 place names come from the already pinned
Natural Earth v5.1.2 inputs. `docs/provenance/discovery-geography.json` records input
and output hashes. Regenerate offline with:

```powershell
node scripts/build-discovery-geography.mjs
```

All four large map modules have content-hashed names and immutable cache headers.
They load by zoom and cache only after use. Installation precaches the small
`world-land` fallback plus application shell; it does not fetch the roughly 32 MB
of overview/detail/terrain/roads data. Offline navigation falls back to the cached
canonical `./` document, not redirected `index.html`. If detail was never downloaded,
offline map use retains the small coastline fallback.
Query-bearing navigations are never written to the shell cache, including OAuth
return URLs that may contain one-time codes. Offline navigation uses the canonical
root instead; versioned module/configuration requests retain normal caching.
Measured shell assets fell from 33,721,853 to 1,924,821 decoded bytes
(94.3% less). This is an installation-payload measurement, not a measured network
latency or physical iPhone benchmark. Detailed geography must be requested in the
current cache generation before it is available offline. Old online module URLs
remain usable through four same-origin compatibility redirects.

## Verification and rollback

Focused tests cover exact-vs-fuzzy ranking, Korean queries, correction disclosure,
large duplicate-family blocks, country fallback honesty, invalid locations, mirror
validation/caching, cache misses/ETags/stale outages, byte caps and offline shell
selection. Browser tests cover one-request cold boot at phone/desktop widths,
cache reload and mirror fallback. Run all existing checks before publication:

```powershell
npm run verify
npm run test:e2e -- --workers=3
npm run test:rendered
npm run test:desktop-renderer
npm run test:desktop-auth
```

Rollback the directory client, finite Function routes, map/search integration and
their module references together, regenerate runtime fingerprint/manifests and
deploy with a newer shell generation. Keep the existing metadata quota Worker and
strict-public flag. Preserve published tags/assets; a desktop distribution change
requires a new version. No account reset, credential rotation or local-data deletion
is a rollback step.

Other review items remain separate: nav consolidation, sync transport/polling,
stream-variant quality controls, remote long-tail search, playback auto-healing,
casting/alarms, and physical-device/screen-reader qualification. Production HTML
did not contain the analytics beacon in the November 8 probe; CSP was not weakened.

References: [Radio Browser server discovery and API](https://api.radio-browser.info/),
[Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Intl.DisplayNames](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DisplayNames),
and the pinned Natural Earth sources in [map provenance](provenance/map-data.json).
