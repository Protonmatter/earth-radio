# Media controls and now-playing information

Earth Radio supplies the browser and operating system with information for their
media controls. The app's existing player remains the audio owner.

| Available information | Title | Artist | Album |
| --- | --- | --- | --- |
| Promoted current song | Song title | Artist | Station name |
| Station only | Station name | Confirmed city and country, or country alone | Earth Radio |
| Stopped | Cleared | Cleared | Cleared |

The song must belong to the actual current station and its source must have
played. Raw ICY text, an incomplete artist/title pair, another station's result,
and an unconfirmed city cannot become identified media metadata. Country labels
follow the existing UI locale. Resolving a new source temporarily uses station
information; a late result cannot replace the newer selection.

## Transport

Play, Pause, Stop, Previous and Next call the existing owned player callbacks.
Previous and Next use the current filtered list and retain the successful-play
selection event gate. They do not inherit automatic World Scan skipping.

Stop invalidates pending source work and station intent, clears timers and HLS,
removes the audio source, clears metadata and leaves the selected station ready
for a later explicit Play. Late load, pause, can-play and ended events cannot
restart or navigate stopped playback. Stop does not clear favorites, songs or
Passport history. Ordinary Pause remains resumable.

Each supported action is registered independently. A missing Media Session API,
unsupported action or failed optional metadata operation does not disable the
normal app controls or start playback.

## Artwork and privacy

For a promoted song with a trusted provider cover, the browser prepares actual
96, 256 and 512 pixel PNG images, preserving aspect ratio. Native media controls
receive those local raster images. While preparation is pending or unavailable,
they use the first-party Earth Radio mark. An image failure leaves song text and
audio usable. Directory favicons and raw remote cover URLs are not handed to the
native image loader.

The fetch path accepts only the existing trusted HTTPS cover CDNs, omits
credentials and referrers, rejects redirects, limits input and encoded output to
2 MiB, and accepts supported raster content. It has a four-second deadline and
at most two outstanding jobs, including canceled decoders that have not finished.
Returned bitmaps must be at most 4,194,304 pixels and 4,096 pixels on either edge.
Bitmaps are closed, and late results are fenced across track, source, Stop and
document changes. The memory cache holds at most four covers and an 8 MiB encoded
character budget; JavaScript and decoded-image allocations have additional
overhead. No resized cover or new listening record is persisted or uploaded.

Image decoding is delegated to the browser. The dimension check occurs when a
bitmap is returned; it is not a guarantee about the decoder's internal peak
allocation. The trusted-origin, input-byte and outstanding-job limits constrain
that exposure. Browser capability, CORS, content or decode failure keeps the
first-party fallback rather than bypassing these guards with a raw remote URL.

## Qualification

```powershell
node --test tests/media-session-core.test.mjs tests/media-session-artwork.test.mjs tests/media-session-controller.test.mjs
npm run test:e2e -- tests/e2e/media-session.spec.mjs --project=chromium --workers=2 --retries=0
npm run verify
npm run test:e2e -- --workers=2 --retries=0
npm run test:rendered
npm run test:desktop-auth
```

Browser tests inspect the actual native `MediaMetadata` object and decode the
generated PNGs as images under the unchanged CSP. A wrapper records only
successful native action registration. Calling those handlers in a test is
synthetic OS input; it does not qualify a physical lock screen or media key.
Held source/import/image tests exercise the real player and request cancellation.
Other tests cover optional API failures, bounded resources and stale results.

Current-source qualification is recorded in [QA 0.36.0](QA-0.36.0.md). Physical
iPhone/Android/Mac/Intel-Windows behavior, OS media surfaces, background audio and
audible fidelity remain separate from browser and native CI fixtures. The primary
API references are the [Media Session specification](https://www.w3.org/TR/mediasession/)
and [action-handler documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setActionHandler).

## Maintenance and rollback

`media-session-core.js` projects text and validates raster descriptors;
`media-session-artwork.js` owns bounded image processing;
`media-session.js` owns optional presentation and callback routing. The audited
runtime bridge and reference `src-recovered/core/player.ts` retain source and
current-list ownership. There is no second audio engine or account store.

Rollback reverts the complete feature and advances the worker generation.
Preserve Passport rows/epochs, account documents, provider/SMTP/vault settings and
all prior release assets. A metadata failure must not select another station.
