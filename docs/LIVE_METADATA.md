# Live metadata feeds

Raw ICY `StreamTitle` text is unreliable: many stations broadcast their own name (or
arbitrary text) instead of the playing track, which is why the enrichment pipeline
deliberately refuses to promote title-only ICY metadata. This document describes the
higher-trust feeds layered above ICY in 0.25.0 and how they compose.

## Source ladder

From most to least trusted:

| Source | Where it runs | Cost | Notes |
|---|---|---|---|
| Audio fingerprint (ACRCloud/AudD) | proxy only | metered per request | On-demand; identifies the actual audio |
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
(default 30s) only while audio is actually playing and the tab is visible.

All proxy-side fetches go through `server/net-guard.mjs`, the same public-target/SSRF
guard the desktop proxy uses for stream probing: private, loopback, link-local, and CGNAT
targets are rejected before and during connection, responses are byte-capped, and
redirects are not followed.

## HLS timed ID3 (free tier)

hls.js surfaces in-stream ID3 frames as a hidden `metadata` text track on the media
element. The overlay watches `audio#audio-player` text tracks and reads `TIT2` (title),
`TPE1` (artist), and StreamTitle-style `TXXX` cues on `cuechange`. No runtime-bundle
changes are required.

## On-demand audio fingerprinting (metered)

`server/fingerprint-providers.mjs` samples ~12 seconds of encoded audio bytes directly
from the stream (no decoding; ICY injection is avoided by not requesting metadata; HLS
playlists are resolved one level and recent segments concatenated) and submits the sample
to a configured provider:

- **ACRCloud** — `ACR_HOST`, `ACR_ACCESS_KEY`, `ACR_ACCESS_SECRET`
- **AudD** — `AUDD_API_TOKEN`

Without credentials the endpoint reports `available: false` and the client hides the
button entirely — fingerprinting is strictly opt-in. Recognition requests are metered by
the providers, so the server enforces a tight per-client rate limit (10/min), a per-URL
result cache (90s hits / 45s misses), and in-flight deduplication; the client adds a
30-second minimum interval. A fingerprint hit is enriched with catalog artwork/links via
the existing identify pipeline and rendered as `Identified` with a
`fingerprint:<provider>` source.

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
fingerprintAutoOnRawIcy: false,   // automatic fingerprint on "Raw ICY only"; off by default
fingerprintMinIntervalMs: 30000
```

`fingerprintAutoOnRawIcy` stays off by default because it spends metered recognition
requests without a user action. The manual "Identify song" button is the intended
default interaction.

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

Stream identity survives MediaSource playback: hls.js exposes only a `blob:` URL on the
audio element, so after successful playback the runtime dispatches
`earthradio:station-selected` (`detail: { streamUrl, stationUuid }`) and the overlay's
exported `resolveStreamUrl` helper prefers a real HTTP(S) media source, then the
selected station URL — never a non-HTTP(S) value — for platform polling and
fingerprinting. Client-only feeds stay in the
browser: listen.moe's realtime song gateway is resolved over WebSocket directly.

When a structured feed names artist and title but no catalog can confirm the track
(common for K-pop/J-pop and regional releases), the panel shows the honest
`Station feed` state instead of hiding the information behind "Raw ICY only".

## Scope

The desktop proxy is still never published; the Pages Functions reimplement only the two
read-only metadata lookups on the Workers runtime with their own budgets and guards.
Spotify enrichment remains server-side-only on the desktop proxy.
