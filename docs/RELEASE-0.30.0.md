# Earth Radio 0.30.0 station search

Browse and Search stations now share one query, country scope and ranked result
pool. Country filtering runs before the palette's 50-result limit. Search accepts
station names, genre/language aliases, country names/codes, directory-supplied
city/region metadata, codecs and bitrates. Best match prioritizes an exact station
name; bounded spelling tolerance includes adjacent transpositions. Explicit sorts
and Recent chronology retain their existing meaning.

Genre and language use searchable, keyboard/IME-aware comboboxes backed by the
existing named selects. Suggestions show station counts in the loaded catalog and
mount at most 24 options. Active chips expose legacy filters, country/view/area
constraints and current facets. Clear search retains filters, Reset filters retains
the query, and Clear all resets discovery. Selecting a country clears a conflicting
map rectangle; area search continues to clear country scope and retain other filters.

Pending palette input cannot select an earlier result. Directory refreshes preserve
composition/pending text. The virtual list observes its container so split changes
and desktop/phone transitions cannot leave narrow station rows. Search state remains
tab-local; account identities, synced documents and playback ownership are unchanged.
No new dependency, map/search service, history store or telemetry is introduced.

Shell `earth-radio-shell-v64-frictionless-search` and coherent 0.30.0 module URLs
carry the update. See [discovery](DISCOVERY.md), [qualification](QUALIFICATION-0.30.0.md)
and [installation](INSTALLATION.md). Publication requires exact-source CI, both Pages
deployments, Windows ARM64 installer/portable, Apple Silicon/Intel unnotarized DMGs
and anonymous checksum readback. Release provenance and Spaces record final identities.
Existing published tags/assets remain immutable.

Rollback: revert the release's tracked source as a unit, regenerate provenance and
manifests, run verification, and deploy the prior behavior with a newer shell name.
Publish a new desktop version; never replace an existing release's binaries.

Country-picker focus reuses the existing cached, single-flight directory country
index, so countries absent from the initial sample remain selectable. Its counts
come from that index when available; genre/language counts describe loaded stations.
Only explicit country selection expands station coverage. Offline index loading
retains loaded-country choices and remains retryable on the next focus.
