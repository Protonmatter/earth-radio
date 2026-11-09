# Directory, search and map reliability

This follow-up addresses the five high-impact findings from the November 8 review:
cold-start directory fan-out, fuzzy ranking ahead of exact matches, repetitive
initial results, missing map positions, and large install-time map downloads.
It retains the existing playback, station UUID, favorites, account and sync contracts.

## Directory boundary and refresh

Version 0.32 serves scheduled, normalized public metadata through the existing
same-origin Pages Function. The hourly producer and atomic GitHub Pages artifact,
limits, integrity checks, permissions and rollback are documented in
[DIRECTORY_PUBLICATION.md](DIRECTORY_PUBLICATION.md). The browser still makes one
root snapshot request on a cold boot; selected additional countries add bounded
requests. The global sample contains at most 10,000 original UUIDs, grouped into
logical stations. It is not an exhaustive global index or authoritative transmitter
database. The November 9 initial publication was about 6.17 MB decoded / 1.18 MB
gzip for the grouped view. Transfer, decoded and service-worker-cache bytes are
different measurements.

The finite paths remain /directory/snapshot, /directory/countries,
/directory/servers and /directory/country/XX (uppercase ISO, at most 1,000 IDs).
Query strings, arbitrary targets and write methods are rejected. The new client
explicitly requests application/vnd.earthradio.catalog.v2+json; old application/json
root clients and default-Accept country clients retain flat arrays. Cache keys and
strong content ETags distinguish those representations. A manifest carries source
SHA, generation time and exact payload hashes; request clocks never define content
identity. A cached manifest pointing at a removed old blob triggers one forced
manifest refresh under the original deadline.

The edge only fetches a fixed HTTPS project-site origin and validated hash paths,
refuses redirects, verifies decoded byte counts and SHA-256, and never parses the
multi-MB catalog JSON. The 16 MiB response cap, 128 KiB manifest cap and 15-second
absolute network deadline apply. Cached last-good responses live at most seven
days without replacement. After five minutes, background refresh checks publication;
failure retains the old response and starts a one-minute retry cooldown. Cold misses
coalesce, with at most four distinct refreshing keys per isolate. Cache operations
are independently bounded and best effort. Generation age over two hours is marked
stale. Cache eviction remains possible; the static publication is the source,
independent of current Radio Browser availability. The reader makes no provider call.

The desktop uses the same verified publication through the existing DNS/IP-pinned
network guard, keeping its existing record limits and country targeting. Partial
country failure does not discard a valid root catalog. Validated dynamic mirrors
and IndexedDB remain last-resort fallback paths. Direct browser fallback is exposed
to provider CORS/outages and is labeled as live data. No metadata quotas, auth schema,
provider, SMTP, vault, CSP trust source or user account state is changed.

Normalization cleans metadata before publication, preserves original UUID aliases,
rejects invalid/credential-bearing/private-literal stream URLs and records HTTP
transport. Country inference uses nonconflicting directory-name, stream, homepage
or same-name country-provider evidence; it remains a derivation, not verified
location. Unknown countries stay unknown. A country-owned provider domain can
corroborate a sibling only when its ccTLD agrees with the known country. Generic
shared stream hosting does not establish country. Invalid coordinates are removed;
approximate country positions exist only in the presentation layer.

Cards, palette and map project matching streams into one program/country/region
result after relevance ranking. Separate programs, countries and conflicting cities
or states remain separate. Stream aliases retain UUID lookup, account favorites and
old links. Favorites expand only in the view; no cloud document is migrated.
The accessible quality selector prepares the next explicit Play action during idle,
playing and paused states. It never starts audio by itself. Failure can try up to
three distinct sibling streams before the existing bounded station recovery; HTTPS
pages do not automatically fall back to HTTP. HTTP choices carry a limitation badge.
Declared codec/bitrate and directory health are not audio-fidelity measurements.

The successful catalog count appears in status with its snapshot timestamp, not a
blocking toast. Other toasts sit above the player/nav and ignore pointer input.
The atlas excludes presentation points outside -60..85 latitude, including the AQ
fallback that produced the Antarctic cluster. Height-aware Mercator limits constrain
the actual view after resize and map actions. Stations outside the atlas stay in
the list. Root HTML has no-transform to prevent Cloudflare automatic beacon
injection while retaining the self-only script CSP; verify both headers and browser
security logs after deployment.

The publisher never writes source Git history and uses no saved deployment key.
No R2/KV binding, paid resource or dependency was added. Hosting is subject to the
existing free service limits, not unlimited use. Static geography remains locally
served with its existing free/open data notices. Navigation consolidation, CSS
bundle consolidation, sync polling replacement, live-region consolidation and
Remote Playback are outside this release's four-priority scope.

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
Mutable map-core/map-directory rules are explicit: no wildcard can add a second
Cache-Control policy to immutable geography. Site validation rejects overlapping
cache policies, because Pages concatenates matching headers rather than replacing
the earlier value. Production served-header checks remain a separate gate.
They load by zoom and cache only after use. Installation precaches the small
`world-land` fallback plus application shell; it does not fetch the roughly 32 MB
of overview/detail/terrain/roads data. Offline navigation falls back to the cached
canonical `./` document, not redirected `index.html`. If detail was never downloaded,
offline map use retains the small coastline fallback.
Query-bearing navigations are never written to the shell cache, including OAuth
return URLs that may contain one-time codes. Offline navigation uses the canonical
root instead; versioned module/configuration requests retain normal caching.
Measured shell assets fell from 33,721,853 to approximately 1.925 million decoded bytes
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
