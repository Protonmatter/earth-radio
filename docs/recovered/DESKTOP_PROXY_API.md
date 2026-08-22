# Earth Radio Desktop Proxy API

## `/api/track/identify`

Input:

```text
artist=<artist>
title=<title>
raw=<optional raw ICY title>
providers=itunes,spotify
country=US
```

Output:

```json
{
  "found": true,
  "state": "Identified",
  "confidence": 92,
  "track": {
    "provider": "spotify",
    "title": "...",
    "artist": "...",
    "album": "...",
    "genre": "...",
    "isrc": "...",
    "artworkUrl": "...",
    "spotifyUrl": "...",
    "appleMusicUrl": "..."
  },
  "candidates": [],
  "sources": []
}
```

## `/api/streams/nowplaying`

Server-Sent Events endpoint. Emits parsed ICY `StreamTitle` updates:

```text
data: {"streamTitle":"Artist - Title","observedAt":"2026-06-24T00:00:00.000Z"}
```

## `/api/streams/probe`

Returns stream health and ICY headers without relaying stream audio.

## `/api/streams/resolve`

Resolves simple playlist containers such as M3U, PLS, and XSPF to the first playable HTTP(S) URL.

## `/api/stations/federated`

Desktop-local station directory endpoint. It currently seeds from Radio Browser and annotates source claims. It is intentionally shaped like the future hosted federation endpoint so the renderer does not need to care whether it is using local desktop mode or hosted proxy mode.

## Guardrails

Stream URL endpoints call `assertPublicUrl()` before network access:

- only `http` and `https`
- blocks localhost
- blocks private IPv4 ranges
- blocks link-local ranges
- blocks multicast ranges
- resolves DNS before probing domain hosts
- blocks domains that resolve to private addresses
