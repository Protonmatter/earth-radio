# Web 0.37.0 station sharing qualification

Base: accepted main `94974388377c2cf8529603929fb5782b95b1de6f` (PR55).
Candidate: web0.37.0, v81-station-sharing, content-derived runtime fingerprint.
Desktop public0.34.1 remains immutable; the planned installation pass precedes
the combined desktop publication. This record distinguishes completed local work
from hosted/served acceptance. No account/provider/schema/SMTP/vault change.

## Local evidence

The pure protocol extraction passes a frozen52,630-row replay: both manifests and
all707 payloads remain byte-identical to accepted PR55. The five-input receipt
binds the compatibility module and extracted browser-safe protocol. Existing
eleven-city/9,400-component coverage is replayed against current model bytes;
changing release query URLs does not establish a new live data acquisition.

Focused tests pass shared-entry/long-tail cache restore, ID/DTO privacy, Unicode
and HTML escaping, strict generated headers, bounded response parsing, manifest
refresh/removal/LRU, concurrency and noncooperating fetch/crypto/body deadlines.
The Share controller covers native cancellation/failure, concurrent/late work,
clipboard absence/denial, honest success feedback and immutable tapped payloads.
Media tests cover playing/paused/Stop/late metadata and missing native APIs.

The first rendered probe found Share hidden on phones until audio started. The
button now lives beside transport; 320/390/1440 px target/overflow checks pass.
One initial browser expectation incorrectly required raw angle brackets in the
normalized player label. The label normalizer already removes these; the test
now checks that existing behavior separately from exact escaped preview text.
The failed campaign remains diagnostic evidence, not accepted coverage.

The corrected focused campaign passes36 Chrome/WebKit sharing cases, zero retries,
failures or skips. Six playback/compatibility cases pass, including real audio
clock progression, nested dialog focus/audio continuity, Pause/Stop titles and
native-API-absent behavior. Windows WebKit reports Media Session absent; actual
capability observations are retained rather than inferring OS support.

Initial local results are recorded below; the corrected complete local campaign
and same-seat review are now accepted. Exact-head/main CI, actual HTTPS preview/
production route/header/assets and bounded post-deploy monitoring remain gates.

## Independent review and bounded correction

The initial complete local campaign passed858 tests/three existing Windows skips,
519 hashes,460 browser cases with zero retries/failures/skips (19.5minutes),42
rendered scenarios and Windows ARM64 native renderer/auth/encrypted restart,
Passport sync/logout/quit and media-action checks. The real v80→v81 worker upgrade
and offline shared-row/privacy/favorite43%volume checks also passed. These are
pre-correction evidence and do not waive the additional failure case below.

One fresh whole-feature review bound patch
`2506ec2a1cf43a1e21d901037fc3290a9a70bccc9398601e8d71f7a24ec60a6e`, independently
passed108 focused cases/519 hashes and found one P2: a cold shared document could
not select its verified row when the larger directory failed and no cache existed.
Two isolated probes reproduced it; four actual Chrome/WebKit regressions then
failed, including companion saved-station cases. Two pure fallback tests also
failed before implementation. No other qualifying finding was reported.

The correction eagerly consumes the validated entry, normalizes only its exact
identity through the existing data owner and recovers it after catalog failure.
The existing public cache stores an explicitly partial row with savedAt0 and
directoryView0, preventing a fresh-catalog claim or suppressed retry. Settlement
remains unsuccessful for the full directory and localized copy explains the
limited state. Opening the link cannot add favorites/recents or replace last
played. All four outage browser cases and17 focused unit cases pass; the browser
cases include partial-cache reload and recovery to the ordinary full catalog.

The same review seat closes the P2 with no new finding on correction patch
`2d60e4317bc04138da29b71d688bd7beb1649ab35aa43be17d1670f0a6f7279d`, staged
tree`646b39044085924fcedb619bb802e0d7b4afb6f3`. It independently passes76 focused
cases/519 hashes and a warm-full-cache entry probe: exact new identity, unchanged
timestamp, zero catalog reads, enabled controls, removed bootstrap and no audio.
The primary also verifies default-filter Search visibility, explicit silent media
clock progression and Pause on that warm long-tail path. Its initial overly strict
review label assertion was corrected to the intended idle "Play station" label;
no product behavior was weakened.

Corrected local acceptance at2026-11-12T18:09:57.114Z binds861 passing repository
tests/three existing Windows skips/519 working and index hashes; all464 browser
cases pass with zero failures/retries/flaky/skips (20.5minutes). The rendered
matrix completes42 scenarios without errors. Windows ARM64 native sandbox/IPC,
PKCE/token-free renderer, encrypted restart, Passport-only sync, logout/normal quit
and five media actions pass again. Real same-origin v80→v81 upgrade preserves the
favorite/43%volume and privacy floors/mirrors/sync baseline, removes the old cache,
verifies15 dependencies/97entries/4,809,430body bytes and passes offline Passport
import/reload and shared long-tail reload/copy UI without autoplay. No dependency,
raw-map, original-profile, provider, SQL, SMTP/vault or paid-resource change.

Current identity is0.37.0/v81-station-sharing/index-d26191ab.js,284,815bytes,
SHA256`d26191abd489ab5ed63beefa74260b335bdcf18152416717c27a3e2c2e303279`.
Whole-runtime reconstruction permits only the initial seven owner edits, bounded
two-owner outage correction and release identity.35 other existing modules are
release-query-only. Both protocol/direct data extractions preserve their exact
bytes, all four raw map blobs match base and frozen producer/place replays pass.

Review scope rulings accept preservation of exact UUID case, supported public-ID
limits, clean canonicalization, native/OAuth/legacy guards, script-free errors,
escaping/public-field projection, country-only place text/first-party art,
explicit generated headers, bounded stale/saturation behavior, safe redundant
refreshes, pure extraction, quiet cancellation/manual copy, tapped-payload/late
fences, nested focus, matching Play fallback and trusted title/Stop ownership.
Unseen offline links, hosted/served/physical/provider/fidelity qualification and
the separate ER-10/desktop phase remain explicit limits, not silent omissions.

## Not established by fixtures

Physical iOS/Android share-sheet delivery, assistive technology, third-party
provider/email completion, real-world station availability and audio fidelity
require their own evidence. The route resolves public directory metadata; it
does not certify a stream as audible. Public Windows trust, Apple notarization
and physical installer/upgrade checks remain separate desktop qualification.

## Rollback

Use the [sharing rollback](SHARING.md#rollback). The accepted producer prerequisite
and its historical failures/acceptance are documented in
[QA-STATION_LINK_RECORDS.md](QA-STATION_LINK_RECORDS.md) and its public-safe receipt.
