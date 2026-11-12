# ER-09: Station links and sharing

The owner approved the daily-return order, delegated design choices and asked to
stop only for new cost. Base: accepted web0.36.0/main
`80e3ee014bae96dbb13b318cb1c82fb147d3af3d`. No paid resource, dependency,
provider, account permission or database change is required.

## Delivery and architecture

First publish small station records alongside the existing scheduled directory.
Then ship the app's `/s/{id}` route, station-specific Open Graph response, player
Share action and document title. Separate commits/PRs let the actual public record
publication qualify before the app depends on it. Desktop publication follows
sharing and installation (ER-10), as already approved.

The current public catalog is about 6 MB. Parsing it on every cold preview request
is unnecessary work on the existing free edge plan, whose HTTP CPU allowance is
10 ms ([Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)).
A direct live-directory lookup would make sharing depend on upstream availability.
Use 256 SHA-256(UUID)-distributed, content-addressed JSON shards instead. In the
retained 52,630-record sample the largest complete normalized shard is 146,521 bytes.
Enforce256 KiB and1,024 records per shard,64 KiB for its manifest and the existing
128 MiB total publication guard. Exceeding a guard leaves the prior deployment
intact; do not increase limits or enable paid capacity automatically.

The new optional `station-manifest.json` has its own schema 1 identity and256
descriptors. It covers every normalized station, including stream aliases and the
long tail outside the 10k boot catalog. Its records project an explicit public
field allowlist from the existing normalized rows; no account, provider token,
audio, play counter request or listener data is added. Existing schema 2 manifests,
catalog/legacy/country payloads and selection/order remain unchanged. Shards are
sorted by UUID, hashes are over exact newline-terminated UTF-8 bytes and each
descriptor records hash, byte length and count. Generation/source/version bind the
new manifest to the same scheduled pull. Empty shards share one immutable file.

Staging validates both manifests and all referenced bytes before output creation,
rejects symlinks/path escapes/tampering and retains the aggregate128 MiB bound.
Older generations without the optional station manifest remain stageable.

## App follow-on

- Share produces canonical `https://app.earthradio.stream/s/{id}` links containing
  only a public station identity. Keep legacy `#station=` links working and never
  autoplay on arrival.
- The Pages Function fetches a bounded, hash-verified station record from the
  fixed existing public publication origin. It serves escaped station name/place
  metadata and first-party brand artwork. Unknown/invalid identities return an
  honest branded404; unavailable publication returns a retryable error.
- Preserve native `file:` renderer paths and the existing root/hash route. A
  successful browser entry may canonicalize `/s/{id}` to the root/hash after the
  server has supplied the preview and station bootstrap. Do not introduce a
  `<base>` element or weaken CSP to support nested paths.
- Web Share runs directly from the user's tap, with an honest clipboard/manual
  copy fallback and quiet cancellation. Neither source stream URLs nor private
  song/history/account data enter the shared payload.
- Playing titles use trusted promoted-track metadata, otherwise the station,
  followed by ` · Earth Radio`; Stop restores `Earth Radio`. This works when the
  OS Media Session API is absent and never creates a second audio owner.

## Acceptance and rollback

Producer tests cover all normalized identities, aliases, long-tail membership,
permutation stability, byte/count/path/hash guards, staged legacy compatibility
and aggregate limits. Replay retained live input and compare every existing
payload/descriptor with the accepted producer, then run a feature-branch scheduled
build (deployment remains main-only). Require exact-head CI, independent review,
final-main checks and public manifest/shard readback before app integration.

Follow-on qualification adds Chrome/WebKit desktop/mobile direct/legacy links,
unknown/invalid/escaped metadata, no autoplay, share/cancel/fallback, title races,
offline/native regressions and actual served preview/production checks. Physical
share sheets, screen readers and installed-device behavior remain distinct from
browser fixtures. Roll back producer source to the prior accepted commit and run
the existing main-only atomic publication; old clients ignore the optional files.
Do not modify accounts/providers/SMTP/vault, saved UUIDs or prior release assets.
