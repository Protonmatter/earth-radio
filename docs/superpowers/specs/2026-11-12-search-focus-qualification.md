# Search focus and durable-setting qualification

The strict final-main gate for PR50 found two retry-dependent browser results,
despite GitHub reporting success: a palette query and song-history retention.
The metadata source is `715f997e94bd6d1dd62386506f2904eed80e16ee`; its app assets
equal the immutable v0.34.0 release source. No original account was involved.

## Reproduced causes

A controlled replay of the runtime's real deferred focus call moves focus from
`er-station-query` to the hidden `search-input` in Chromium and WebKit. Subsequent
typing leaves the visible query empty, puts `seoul` in the internal engine and
shows all nine fixture stations. The presentation layer currently compensates
with two animation frames, leaving an intervening focus race.

The history test reloads immediately after unchecking. Holding the native
IndexedDB open-success callback shows the control unchecked but disabled while
the write is pending; navigation then leaves the old setting. Releasing the
write, waiting for persisted policy and the enabled control, then reloading
retains history-off in both engines. This is an acknowledgement missing from
the test, not a failure of the completed storage operation.

## Bounded change

Make the internal engine noninteractive using native hidden semantics while
retaining programmatic values/events. Focus the visible station/country field
within the explicit open action. Preserve query, country scope, keyboard
transport, IME composition, Escape, focus return and no-autoplay behavior.

Keep song storage/privacy/account code unchanged. The persistence test must wait
for the real stored policy and completed control state before navigation. Add a
controlled pending-write case, without sleeps or relaxed persistence assertions.

No ranking, loading, geography, station identity, audio, provider, schema,
credential, dependency, telemetry or paid-resource change. User delegates routine
choices and authorizes delivery; only new cost requires a question.

## Acceptance and release

- Deferred native focus cannot steal an active palette edit or composition in
  either engine; typed queries reach the canonical results without autoplay.
- Existing query/country/Enter/Escape/IME and station-loading cases remain green.
- History-off survives reload after durable acknowledgement, including a held
  real IndexedDB callback; owner/backup/deletion behavior remains intact.
- Full verifier, whole browser suite without retries, rendered/native checks,
  one fresh whole-branch review, exact-head CI/preview and final-main/served gates.
- Coherent web/desktop patch0.34.1; retain every v0.34.0 tag/asset and earlier
  evidence. Rebuild six final-source desktop packages, qualify signatures,
  source/metadata/payloads, isolated guest restart and full draft/public hashes.
  Advance current download metadata only afterward. Preserve all original profiles.

The controlled initial probe and the failed main log remain under the metadata
worktree's ignored qualification-readiness and release-034-metadata directories.
These synthetic timing probes do not claim physical iPhone/IME/audio acceptance.
