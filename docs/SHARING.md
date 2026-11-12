# Sharing a station

Use **Share station** beside the player controls, or in Now Playing. A selected
station can be shared before playback. Supported mobile browsers open their
native share sheet; otherwise Earth Radio offers a selected link and **Copy link**.
If clipboard access is absent or denied, select and copy the link manually. A
canceled share sheet does not display an error or claim that anything was sent.

Links use `https://app.earthradio.stream/s/{station-id}`. They carry only a public
station identity, name and country in the share payload. No account, listening
history, song log, query string or direct stream URL is included. Opening a link
selects that exact station without starting audio, saving a favorite or creating
a listening record. Playback still requires a user action. The existing station
cache retains a resolved long-tail station through subsequent catalog refreshes.

If the full directory is unavailable on a first visit, the verified shared row
still reaches the existing selection owner. The UI explains that only this station
is ready. Its normalized public cache is explicitly partial, with an expired
timestamp and a noncurrent directory-view marker; the next load must retry the
directory. A successful refresh replaces that partial cache. A remembered station
cannot replace the shared identity, and opening the link does not add history.

## Public response and data ownership

The Pages Function reads the existing published station manifest and the one
SHA-256-bound shard selected by the exact station ID bytes. It also supports the
two existing LISTEN.moe built-in identities. It does not download the full
directory or require an account. The public protocol is shared with the producer;
the server compatibility re-export preserves existing callers and wire format.

The route accepts GET/HEAD, redirects noncanonical spellings and query-bearing
links to a clean path, returns 404 for absent/invalid stations and 503 with
Retry-After for unavailable metadata. It never substitutes the last-played station.
Lookup has a five-second budget, four in-flight fetches, four parsed shard cache
entries, five-minute manifest freshness and a seven-day stale-generation ceiling.
Redirects, oversized bodies, invalid UTF-8/schema, changed descriptors and hash
mismatches fail closed. A removed old shard permits one bounded manifest refresh.

The returned shell has station-specific escaped Open Graph text, the existing
brand image, explicit security headers, `no-store` and `noindex, follow`. An inert,
bounded JSON block carries only permitted public station fields. Before startup,
the entry controller checks its identity/protocol, moves to the legacy root hash
and removes the block. Generated documents root their asset URLs; the desktop
file shell retains relative paths. Root/OAuth query and native file paths do not
pass through the shared-web entry controller. The marketing site's `/s/*` paths
retain its own route handling.

The title follows the owned player and trusted song projection. Pause retains
context; Stop clears it. This presentation works without the Media Session API
and does not add audio, polling, account I/O or artwork fetching on unsupported
native surfaces. No telemetry or paid resource is added.

## Verification

```powershell
npm run verify
npm run test:e2e -- station-sharing.spec.mjs station-sharing-playback.spec.mjs media-session-compat.spec.mjs --workers=1
npm run test:e2e -- --workers=1
npm run test:rendered
npm run test:desktop-renderer
npm run test:desktop-auth
```

Tests exercise the real generated-document handler and player with controlled
public metadata and silent WAV fixtures. They cover long-tail cache expiration,
Unicode/script delimiters, exact IDs, bounded lookup, methods/errors, copy/native
API cancellation and denial, nested focus, six locales, RTL, 320/390/1440 px and
title/Stop behavior. They do not establish an OS share sheet delivering to another
application, physical devices, real provider sign-in or audio fidelity.

## Rollback

Restore the preceding complete app deployment, then ship a forward cache generation
if a correction is needed. Never overwrite an immutable runtime filename or reuse
v81 for changed shell bytes. The optional producer index can remain published;
the old app ignores it. Preserve existing IndexedDB/local collections, account
identities, providers, SMTP/vault settings, station UUIDs and old desktop assets.
See [candidate qualification](QA-0.37.0.md) for current delivery gates.
