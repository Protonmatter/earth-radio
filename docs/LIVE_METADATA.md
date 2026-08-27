# Live metadata feeds

Raw ICY `StreamTitle` text is unreliable: many stations broadcast their own name (or
arbitrary text) instead of the playing track, which is why the enrichment pipeline
deliberately refuses to promote title-only ICY metadata. This document describes the
higher-trust feeds layered above ICY in 0.25.0 and how they compose.

## Source ladder

From most to least trusted:

| Source | Where it runs | Cost | Notes |
|---|---|---|---|
| Audio fingerprint (ACRCloud/AudD) | desktop proxy or Pages Function | metered per request | Auto-runs once when free feeds miss the playing station; Identify button remains |
| HLS timed ID3 | browser | free | Read from the hls.js hidden metadata text track |
| Hosting-platform now-playing API | browser and/or proxy | free | Structured artist/title from the station's platform |
| ICY `StreamTitle` | existing pipeline | free | Raw broadcast text; still confidence-gated |

A fresh higher-trust feed owns the now-playing identity panel; DOM-scraped ICY text only
drives identification when nothing better has arrived recently. Text feeds (platform,
HLS ID3) still resolve through the same catalog identify pipeline, so scoring, promotion
gates, and provenance reasons remain uniform.

## Hosting-platform now-playing (free tier)

`server/platform-nowplaying.mjs` (proxy) and the mirrored logic in
`site/assets/metadata-enrichment.js` (browser-direct) derive candidate endpoints from the
station's stream URL:

| Platform | Detection | Endpoint |
|---|---|---|
| LISTEN.moe | `listen.moe` stream host | `wss://listen.moe/gateway_v2` (K-pop: `/kpop/gateway_v2`); browser WebSocket only |
| SomaFM | `*.somafm.com/<channel>-<bitrate>-<codec>` | `https://somafm.com/songs/<channel>.json` |
| AzuraCast | `/listen/<station>/…` path | `<origin>/api/nowplaying/<station>` |
| Zeno.FM | `stream.zeno.fm/<mount>` | `https://api.zeno.fm/mounts/metadata/subscribe/<mount>` (SSE, first event) |
| Radio.co | `*.radio.co/s??????????/…` | `https://public.radio.co/stations/<id>/status` |
| Laut.fm | `stream.laut.fm/<station>` | `https://api.laut.fm/station/<station>/current_song` |
| Radiojar | `*.radiojar.com/<mount>` | `https://www.radiojar.com/api/stations/<mount>/now_playing/` |
| Icecast | any stream origin | `<origin>/status-json.xsl` (mount-matched) |
| Shoutcast v2 | any stream origin | `<origin>/stats?json=1` |

Browser-direct mode simply attempts the fetch; platforms without CORS fail silently and
the desktop proxy path covers them. Combined "Artist - Title" strings are parsed by the
same `parseNowPlaying` used for ICY so junk/ad text is rejected consistently. Results are
cached per stream URL (20s hits / 5min misses) and polled every `platformPollMs`
(default 30s) only while audio is actually playing and the tab is visible. The desktop
platform resolver uses the same 20-second hit lifetime but retries misses and all-probe
transport failures after 30 seconds rather than suppressing them for five minutes. One
absolute resolution deadline covers every desktop probe: specialized platform endpoints
run first, then the independent generic Icecast and Shoutcast probes run concurrently
and are cleaned up together at that deadline.

All radio-controlled Node fetches go through `server/net-guard.mjs`. `requestPublic`
accepts only credential-free HTTP(S) URLs, resolves and validates every redirect hop,
pins each connection to its validated DNS result, and applies one absolute deadline to
DNS, connection, redirects, and response-body reads. The policy rejects private,
loopback, link-local, unspecified, multicast, CGNAT, benchmarking, and documentation
networks (including `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, and
`2001:db8::/32`), plus stable special-purpose IPv6 ranges such as `100::/64`,
`64:ff9b:1::/48`, Teredo, 6to4, and top-level address-space blocks that IANA marks
Reserved by IETF. Node and Pages import the same binary parser and classifier, including
for expanded IPv4-mapped, IPv4-compatible, WKP, and legacy translated forms; ordinary
globally routed IPv6 and embedded forms with a public IPv4 suffix remain allowed. Redirect loops,
missing locations, and more than four redirects fail closed. Node destroys redirect
responses before settling and propagates caller cancellation to the active request and
response. Fixed recognition-provider POSTs are outside this listener-controlled
boundary and retain their provider-specific destinations and abort timers.

## HLS timed ID3 (free tier)

hls.js surfaces in-stream ID3 frames as a hidden `metadata` text track on the media
element. The overlay watches `audio#audio-player` text tracks and reads `TIT2` (title),
`TPE1` (artist), and StreamTitle-style `TXXX` cues on `cuechange`. No runtime-bundle
changes are required.

## On-demand audio fingerprinting (metered)

`server/fingerprint-providers.mjs` and `functions/api/track/fingerprint.js` share HLS
playlist parsing in `server/hls-playlist.mjs`, sample about
12 seconds of encoded audio bytes directly from the stream (no decoding; ICY injection
is avoided by not requesting metadata) and submit the sample to a configured provider:

- **ACRCloud** — `ACR_HOST`, `ACR_ACCESS_KEY`, `ACR_ACCESS_SECRET`
- **AudD** — `AUDD_API_TOKEN`

Without credentials the endpoint reports `available: false` and the client hides the
button entirely — fingerprinting is strictly opt-in. Recognition requests are metered by
the providers. The desktop proxy enforces 10 requests/minute/client, in-flight
deduplication, and a bounded per-stream cache; both runtimes cache hits for 25 seconds and
misses for 30 seconds. The browser adds a 30-second minimum interval. On Pages, the
durable rate policy is the required zone WAF rule documented below, not an in-isolate
counter. A fingerprint hit is enriched with catalog artwork/links via the existing
identify pipeline and rendered as `Identified` with a `fingerprint:<provider>` source.

HLS sampling uses the final redirected URL as the base for relative references, follows
a bounded master/media playlist chain, and concatenates at most the three most recent
media segments. Fragmented MP4 includes an `EXT-X-MAP` initialization segment; Pages
and Node both keep only the coherent suffix after a map transition. Byte-ranged fMP4
maps and segments accept RFC 8216 `BYTERANGE` with an optional `@offset`; an omitted
offset continues after the previous sub-range of the same resource. A playlist identified
only by its HLS content type is parsed from the body already fetched, for both master and
media playlists. Playlist reads are capped at 64 KiB and the combined sample at 1 MiB.
Pages shares a 16-attempt allowance across playlists, initialization data, segments, and
redirect hops. Every HLS subrequest re-enters its runtime's public-target guard and shares
the caller's original absolute deadline; a redirect or slow body cannot reset that budget.

Endpoints (mounted by both the desktop proxy and `server/example-proxy.mjs`):

```text
GET /api/streams/platform-nowplaying?url=<stream-url>
GET /api/track/fingerprint                # availability probe
GET /api/track/fingerprint?url=<stream-url>[&country=US]
```

## Configuration

`site/config.js` `metadataEnrichment` block:

```js
platformNowPlayingEnabled: true,
platformPollMs: 30000,
hlsId3Enabled: true,
fingerprintEnabled: true,
fingerprintAutoOnRawIcy: true,    // auto-identify the playing stream when free feeds miss
fingerprintMinIntervalMs: 30000
```

`fingerprintAutoOnRawIcy` is on by default so a playing station that has no structured
feed is identified from the audio after an 8-second delay. That path is still a no-op
until Pages (or the desktop proxy) has recognition credentials: without them
`/api/track/fingerprint` reports `available: false` and the overlay never spends a
sample. The 30-second client interval and the zone WAF (6/min/IP) remain the budget.
The Identify button stays available for a manual retry. Structured Station feed
results (LISTEN.moe, SomaFM, parsed ICY with artist and title) skip fingerprinting.

iHeart / MediaBase ICY blobs (`title="…",artist="…"`) are parsed into artist/title
before the generic dash splitter. Trailing station branding such as
`Classic Vinyl on walmradio.com` is stripped so a `Title by Artist` payload survives.

## Same-origin Pages Functions (public web)

Browsers cannot read ICY metadata, so the static deployment gains two same-origin
Cloudflare Pages Functions (`functions/` at the repo root; deployed automatically by the
git-integrated Pages project as long as its root directory is the repository root):

```text
GET /api/nowplaying                 # availability probe (feature-detected by the overlay)
GET /api/nowplaying?url=<stream>    # one-shot ICY read + platform status, keyless
GET /api/track/fingerprint          # availability probe
GET /api/track/fingerprint?url=...  # env-keyed (set ACR_* or AUDD_API_TOKEN on the Pages project)
```

The overlay feature-detects the API at runtime; on a static-only deployment the probe
404s and everything degrades to browser-direct behavior. Deployments must also apply
the external edge controls in `docs/CLOUDFLARE_DEPLOYMENT.md`: the
`global_fetch_strictly_public` compatibility flag (`wrangler.jsonc`, enforced by
repository validation) and the zone WAF rate limits (30/min/IP for `/api/nowplaying`,
6/min/IP for `/api/track/fingerprint`, HTTP 429 for 60s), which are the single durable
rate policy for the metered fingerprint route.

The Pages handlers pass their own request origin as a forbidden origin. The shared
Workers boundary accepts only credential-free HTTP(S) URLs, blocks the same zone and
literal private/reserved targets before each fetch, follows redirects manually, and
revalidates every relative or absolute `Location`. It normalizes alternate IPv4 and
IPv4-in-IPv6 spellings through the same binary public-IP classifier imported by the Node
boundary. `wrangler.jsonc` must retain `global_fetch_strictly_public` because
Workers cannot perform the Node boundary's DNS pinning; the flag makes Cloudflare's
public-network egress enforcement part of the deployed boundary.

`/api/nowplaying` establishes one 11-second deadline. Platform probes use only their
allocated slice, generic Icecast/Shoutcast probes run concurrently, and the resolver
reserves eight seconds for the final ICY read. Redirects and capped body reads consume
that same deadline. The Pages fingerprint route establishes one 20-second deadline for
stream/HLS sampling, recognition, and optional catalog enrichment. The desktop route
uses one 40-second deadline for the same complete operation. Recognition-provider POSTs
remain fixed-destination and are capped at 15 seconds or the operation's remaining time,
whichever is shorter; callers joining a desktop in-flight request keep their own
deadline.

Stream identity survives MediaSource playback: hls.js exposes only a `blob:` URL on the
audio element, so after successful playback the runtime dispatches
`earthradio:station-selected` (`detail: { streamUrl, stationUuid }`) and the overlay's
exported `resolveStreamUrl` helper prefers a real HTTP(S) media source, then the
selected station URL — never a non-HTTP(S) value — for platform polling and
fingerprinting. Same-station media reattachment and reconnects preserve that canonical
URL and UUID; only a correlated station change or clear invalidates them. Poll results
carry a monotonically increasing generation so a superseded response cannot overwrite
newer same-station metadata. Client-only feeds stay in the browser: listen.moe's realtime
song gateway is resolved over WebSocket directly. LISTEN.moe J-pop and K-pop are
git-catalogued in `site/assets/pinned-stations.js` so they appear in the directory
even when Radio Browser's featured-country set does not include Japan; the overlay
merges those records into Radio Browser and desktop federated responses and into a
warm `stations.v3` cache before the recovered bundle's first read.

When a structured feed names artist and title but no catalog can confirm the track
(common for K-pop/J-pop and regional releases), the panel shows the honest
`Station feed` state instead of hiding the information behind "Raw ICY only".

## Scope

The desktop proxy is still never published; the Pages Functions reimplement only the two
read-only metadata lookups on the Workers runtime with their own budgets and guards.
Spotify enrichment remains server-side-only on the desktop proxy.
