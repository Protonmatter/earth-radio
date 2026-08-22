# Earth Radio 0.24.0 — Metadata Enrichment Implementation

## Goal

Add a robust now-playing metadata pipeline:

```text
ICY StreamTitle
  -> parse artist/title
  -> resolve catalog candidates from iTunes and optional Spotify
  -> score candidates
  -> cache result
  -> render confidence, sources, raw metadata, and service links
```

## Implemented in this package

### Renderer/web bundle

New files:

```text
dist/assets/metadata-enrichment.js
dist/assets/metadata-enrichment.css
```

Patched files:

```text
dist/index.html
dist/config.js
```

The renderer overlay is loaded as a same-origin ES module. It observes the existing player/now-card DOM, parses live ICY titles already surfaced by the app, and adds a metadata-confidence drawer under the now-playing service links.

### Server/proxy scaffolding

New files:

```text
server/metadata-providers.mjs
server/metadata-api.mjs
server/example-proxy.mjs
```

The proxy resolver supports:

- `GET /api/track/identify?artist=<artist>&title=<title>&providers=itunes,spotify`
- keyless iTunes lookup
- optional Spotify Web API lookup using `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`
- confidence scoring
- provider attribution
- cache-control hints

Spotify is deliberately server-side only. Do not put Spotify client secrets in the browser bundle.

## UI states

The metadata panel now differentiates:

| State | Meaning |
|---|---|
| `Station metadata only` | No ICY StreamTitle has arrived yet. |
| `Identifying…` | A raw ICY title was parsed and catalog lookup is running. |
| `Identified` | Candidate score is at or above `minIdentifiedConfidence`. |
| `Likely match` | Candidate score is at or above `minLikelyConfidence` but below identified. |
| `Raw ICY only` | The station sent a title, but no catalog match cleared the threshold. |

## Confidence scoring

Current scoring:

```text
+40 exact normalized title match
+32 near-exact title match
+up to +18 fuzzy title match
+30 exact normalized artist match
+24 near-exact artist match
+up to +16 fuzzy artist match
+10 ISRC agreement across providers
+4 catalog genre returned
+4 catalog artwork returned
+2 preview available
-28 artist mismatch
-38 cover/karaoke/tribute penalty
```

Default thresholds:

```text
Identified: >= 78
Likely match: >= 58
Raw ICY only: below 58
```

## Cache behavior

Browser cache key:

```text
earth-radio-track-identity-cache-v1
```

Default TTLs:

| Result | TTL |
|---|---:|
| high-confidence match | 30 days |
| low-confidence match | 1 day |
| miss/no match | 6 hours |

## Runtime config

`dist/config.js` now supports:

```js
metadataEnrichment: {
  enabled: true,
  iTunesDirectEnabled: true,
  spotifyProxyEnabled: true,
  minIdentifiedConfidence: 78,
  minLikelyConfidence: 58,
  cacheTtlHighMs: 2592000000,
  cacheTtlLowMs: 86400000,
  cacheTtlMissMs: 21600000,
  requestTimeoutMs: 6500,
  maxCandidates: 8
}
```

## Running the metadata proxy locally

```bash
SPOTIFY_CLIENT_ID=<client-id> \
SPOTIFY_CLIENT_SECRET=<client-secret> \
node server/example-proxy.mjs
```

Then set:

```js
window.RADIO_CONFIG = {
  proxyBaseUrl: 'http://127.0.0.1:8787',
  metadataEnrichment: { enabled: true }
};
```

## Validation

Run:

```bash
npm run smoke:metadata
```

The smoke gate checks:

- overlay JS syntax
- server JS syntax
- HTML integration
- config integration
- ICY parser behavior
- junk/ad metadata rejection

## Desktop rebuild note

The uploaded `0.23.0` bundle did not include Electron main/preload source. This implementation patches the web/renderer bundle and adds server modules, but it does not mutate the already-built Windows/Linux executables. Rebuild the Electron desktop artifacts from source after applying these files to the real project.
