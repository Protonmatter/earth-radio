# ER-11: Track-level Media Session

The owner approved the daily-return delivery order, delegated design choices and
instructed us to ask only for new cost. This is the next isolated feature after
Passport web0.35/main `7e5e33b0ccc52c9cff016ae53c28ff5196a9be09`. No new paid
resource, dependency, account permission, provider setting or database change is
required. Desktop publication follows sharing and installation in phase4.

## Current behavior and problem

The recovered runtime owns the one audio element, load generation, reconnect
timers, station intent and current-list navigation. `Tr()` assigns a station name,
raw country and one arbitrarily labeled512px favicon to Media Session. `lr()` can
overwrite only its title with raw ICY. Four actions are registered inside one try
block; Stop is missing. `src-recovered/core/player.ts` is a reference, not a
reproducible bundle source, and its unused stop function was tree-shaken out of the
actual runtime. The live runtime's `ar()` is a status getter, not Stop.

`metadata-enrichment.js` already publishes cloned, normalized promoted songs with
station UUID and safe provider artwork through `getCurrentSongSnapshot` and
`subscribeCurrentSong`. Its authoritative station-selected/cleared events fence
late metadata work. Reuse that boundary instead of introducing another parser,
catalog request or confidence decision.

## Design

Add maintained pure metadata, artwork and lifecycle modules, plus narrow audited
runtime integration. Mirror the engine changes in the reference TypeScript.

- A known promoted song is eligible only for the actual current station UUID and
  after that source has played. Title=track, artist=artist, album=station name.
  During loading or without a valid song, use station title and corroborated
  city/country (country alone where precision is unavailable). Never manufacture
  a city or present raw broadcast text as an identified song.
- Idle/Stop clears metadata and sets playbackState=none. Playing and paused keep
  their proper state; errors/ended must not leave a playing state behind. A raw
  ICY title no longer writes MediaMetadata directly. The existing exported
  reference API delegates to the maintained controller.
- Register play, pause, stop, previous and next independently, so one unsupported
  action does not prevent the others. Commands call the existing audio owner and
  current-list callbacks. Registration/refresh never starts playback.
- Stop first uses the owned pause path to invalidate the load token and station
  intent, clears timers/HLS/source, resets the source-played flag, and establishes
  an explicit stopped state. Late pause/loadstart/canplay/ended events cannot
  replace idle or trigger navigation. The next explicit play attaches a source
  normally. Notify the existing station-cleared metadata boundary so stale song
  work cannot return after Stop. Keep the selected station, favorites and route
  available for an explicit replay.
- Country labels use the existing place/country helpers and current UI locale.
  Subscribe to the promoted-song boundary and refresh on owned state/selection
  transitions. Dispose listeners/work on a non-BFCache page exit.

## Artwork

Use only already normalized trusted-provider cover URLs, with a first-party512px
brand fallback. Do not use arbitrary directory favicons or invent their sizes.
For an available cover, produce actual96,256 and512px square PNG images in memory
with a bounded browser bitmap/canvas operation. Preserve aspect ratio and center
the image. No data URL is stored in account documents or persistent caches.

The loader admits only HTTPS on the existing trusted CDNs, rejects credentials,
nondefault ports and redirects, omits credentials/referrers, caps input at2MiB,
rejects unsuitable raster content, uses an abort deadline and bounds decoded
dimensions/output/cache size, and permits at most two outstanding decode jobs
including canceled jobs whose platform promise has not finished. Close decoded bitmaps. Keep a small bounded memory
cache and avoid repeated fetches for the same active cover.

Browser capability, CORS or image failure keeps the first-party brand artwork;
never pass the original remote URL to the native image loader, where it could
bypass the fetch byte/redirect guards. Text appears immediately and a cover
failure cannot affect audio or metadata text. Station/track/Stop/dispose changes abort pending work. A late resize result
may publish only into the exact current metadata generation. This is ordinary
local image processing, with no image-generation service or new API credential.

## Contracts to preserve

ER-01 explicit station/World Scan intent and shared sibling budget; ER-02 counters
only after trusted playing; current-list previous/next and successful-selection
events; source/HLS/reconnect generation fences; search/filter typing and focus;
song trust and account namespaces; Passport minute/off/clear/import fences;
provider/SMTP/vault identity; offline shell and actual route behavior. The four
large map files and their URLs remain unchanged. No new analytics or notification.

## Acceptance evidence

Pure tests cover promoted vs wrong-station/raw/malformed songs, honest place
fallback, Unicode and hostile text/URLs, truthful artwork sizes, capacity and
unsupported APIs. Controller tests cover each action, throwing/unsupported actions,
same-track updates, late artwork across station/track/Stop/dispose and no autoplay.

Browser tests inspect the actual native MediaMetadata object. A wrapper records
registered native action callbacks without replacing Media Session/MediaMetadata;
invoking those callbacks is synthetic OS input, not a physical lock-screen test.
Use real generated media, controlled feed/artwork and delayed playlist/HLS/image
responses to prove track fields, country/city fallback, actual PNG dimensions,
pause/resume, Stop/replay, current-list previous/next, late-load cancellation and
failure isolation. Preserve all existing suites and run full zero-retry browser,
rendered and native gates. Unsupported APIs must leave normal player controls
usable and produce no uncaught error.

One appropriate fresh source review, exact-head/main CI, actual preview/production
artifact/header/route/UI/offline checks and a bounded canary precede acceptance.
Physical OS controls, background audio and audible fidelity are separate evidence.

## Release and rollback

Advance coherent web0.36.0 module/runtime identity and a fresh v80 shell after the
feature settles. Include its small dependencies, refresh controlled provenance,
frozen place-model hashes where release URLs change, and canonical manifests.
Reconcile the now-completed Passport plan/qualification facts with its immutable
head/main/source/SQL evidence as part of this authorized feature documentation.

Rollback reverts the complete Media Session integration and advances the shell
generation. Preserve Passport data/epochs, all account documents and the additive
SQL key; no provider or credential rollback is needed. Keep old release tags and
assets. Do not turn a metadata failure into audio fallback to another station.

Primary references checked November12,2026:
[Media Session specification](https://www.w3.org/TR/mediasession/),
[action handlers](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setActionHandler),
[artwork](https://developer.mozilla.org/en-US/docs/Web/API/MediaMetadata/artwork).
