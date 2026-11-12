# ER-09 app sharing, previews and title

Base: accepted main `94974388377c2cf8529603929fb5782b95b1de6f` (PR55), app0.36.0.
The owner approved the delivery order and delegated implementation/design choices;
only new cost requires a question. The station-record prerequisite is already
published and qualified. This change requires no new service, dependency, provider,
account permission, schema, telemetry or paid resource.

## User behavior

- Share is available on the player and in its expanded station controls. A tap
  uses Web Share immediately with the public station name, country and canonical
  `https://app.earthradio.stream/s/{id}` URL. Cancellation is quiet. When Web Share
  is unavailable or fails, a compact dialog provides a Copy button and selectable
  link. Report successful copying only after the clipboard call succeeds; denied
  or absent clipboard access leaves an honest manual-copy path. No message is
  sent automatically, and no stream URL, query, profile, song log or account data
  enters the shared payload.
- Opening `/s/{id}` returns station-specific server-visible Open Graph metadata,
  then selects that station without playing. It works for all currently published
  identities, including aliases and the long tail beyond the boot catalog. The
  two built-in LISTEN.moe identities also have public links. Existing `#station=`
  URLs and native file-based entry retain their behavior.
- After the server supplies the preview and bounded station bootstrap, the browser
  replaces the path entry with the existing root station fragment. Incoming query
  and fragment data are not forwarded. This preserves the root offline shell and
  route owner without adding a base element or changing native asset paths.
- During playback the browser title is `{trusted track or station} · Earth Radio`;
  paused playback retains its context. Stop resets it to `Earth Radio`, including
  late metadata/source races. This works without the OS Media Session API and uses
  the same authoritative metadata/transport adapter, never a second audio owner.

## Metadata and HTTP boundary

The Pages Function reads only the fixed existing publication origin's validated
station manifest and one SHA-256(UUID)-selected shard. Reuse the schema, hash,
count and byte limits qualified in PR55. Use request-owned fetch/body work with
redirect rejection, omitted credentials/referrer and a shared deadline. Keep only
bounded immutable parsed public data between requests; do not share live Response
objects or I/O promises across requests. Cache at most one manifest and four shards,
with bounded refresh and one manifest refresh after a removed shard. No database,
audio, play counter, live Radio Browser fallback or private credential is involved.

Unknown or malformed identities return branded HTTP404 with no app script. A
publication/asset failure returns a retryable503. GET and HEAD agree; other methods
return405. Extra path segments never become asset or upstream URLs. Canonical
redirects stay on the request origin so previews remain testable; shared URLs and
Open Graph canonical identity always use the production app origin.

Preview place is the short country name from its normalized code. Do not infer
a city or physical broadcaster position from unqualified text. This avoids loading
the client search vocabulary and thousands of CLDR aliases on an edge request;
broader city-confidence work remains ER-16. Use the existing first-party brand
image, not a hotlinked station image. Names/metadata are escaped; the inert JSON
bootstrap additionally escapes script delimiters and Unicode separators. Its raw
size is bounded. Relative asset attributes in the controlled app template become
root-relative only in the generated response, with tested sentinels and no base
element. The unchanged native source HTML retains relative paths.

Cloudflare does not apply `_headers` to generated Function responses
([documentation](https://developers.cloudflare.com/pages/configuration/headers/)).
Set the existing document security policy explicitly, and contract-test it against
the static policy. Share responses use no-store/noindex and no-referrer. Remove
stale asset ETag, length, encoding and last-modified headers after transformation.
Do not weaken script policy, frame restrictions or other existing capabilities.

## Client and runtime boundaries

Extract built-in station constants into a pure module; preserve the existing
`pinned-stations.js` export and merge/cache APIs. Move the already-pure station
record protocol into a browser module and re-export it through its existing server
path, so the inert bootstrap is validated by the same protocol. Extend the retained
producer proof to bind that implementation file and replay all unchanged payloads.
There is no wire-format or public-interface change.

The entry module validates identity and record before merging it through the
existing pinned live/cache paths. It does not write favorites, accounts or playback
history. An unknown server link never boots the app into a different last-played
station. A previously visited station can reload through the normal root offline
shell; an unseen link still needs network access.

Initialize a maintained sharing controller from the owned player wiring, with a
read-only selected-station callback and existing toast callback. Refresh it when
the owned player bar changes. Keep selection resolution aligned with the existing
Play action; do not introduce polling or window-global audio controls. Native
Share/copy uses ordinary browser APIs, with no new IPC or Node exposure. A pending
share freezes the tapped public station; late promises cannot affect a disposed UI.
Focus, Escape, RTL,44px targets and reduced-motion behavior follow existing controls.
All six locales receive the same complete set of new strings.

The Media Session controller also owns the document title presentation, including
when native Media Session is absent. Preserve current-song owner/played/state
fences, Stop blocking, stale completion cancellation, native actions and artwork
limits. Resolve service-worker registration relative to its module URL, not the
incoming document path. Mirror narrow engine changes in reference TypeScript;
it remains evidence rather than a reproducible runtime source.

## Release, qualification and rollback

Ship coherent web0.37.0/runtime fingerprint/worker generationv81. Add only required
small modules to the offline shell; large map data stays out of precache and keeps
its existing content hashes. Keep published desktop0.34.1 intact until ER-10 and
phase-four release qualification complete.

Require pure/edge RED→GREEN cases for malformed IDs, Unicode/escaping, bounds,
removed shards, cache/request ownership, strict headers, aliases and long-tail
lookup; browser cases for actual generated HTML, direct/legacy links, no autoplay,
Web Share/cancel/copy/manual failure, title/Stop races, cached restart and routing.
The loopback server runs the real handler with controlled assets and metadata,
not a separately invented page. Qualify a real HTTPS preview, all existing
search/filter/playback/account/Passport tests, native and rendered gates, and an
actual worker upgrade/offline reload. Clipboard/share fixtures avoid sending to
recipients or reading the user's personal clipboard. Physical share sheets and
new live provider sign-in remain separate from those controlled tests.

After source review and exact-head CI/preview acceptance, merge with expected head,
verify identical final tree and final-main CI, then production routes/previews/UI/
hashes and bounded canary. Update Spaces and guides with evidence and boundaries.
Rollback to the accepted0.36 app with a fresh worker generation; retain the public
station index, saved UUIDs, profiles, Passport/history epochs, providers/SMTP/vault
and prior assets. Continue ER-10, desktop publication and phase five.
