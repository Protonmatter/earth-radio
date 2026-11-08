# Frictionless station search

The listener should type once, understand the current scope, and recover without
rebuilding a search. Keep the approved Earth Radio appearance and existing radio,
map, account, country expansion and station-selection contracts.

## Chosen approach

Use the existing discovery ranker as the one result authority for inline Browse
search and the Search destination/palette. Mirror query and scope between those
presentations. Country selection continues through the existing bounded expansion
scheduler, with ISO/name aliases and an explicit visible country scope. The palette
uses the ranked runtime pool before its existing fifty-result presentation limit.
Typing never starts audio; existing explicit result activation remains available.

Replace long genre/language menus with progressive searchable comboboxes backed by
the existing named selects. Show popular loaded-catalog options, bounded matching
options and counts. Selected options remain removable even if a refreshed catalog
does not contain them. IME, keyboard, pointer, focus and native fallback are required.

Expose every active discovery/runtime constraint as a removable chip in both search
presentations. Separate Clear search from Reset discovery. Empty results offer
query-only clearing and filter/scope reset while retaining the query. Country and
map-area choices replace conflicting geographic scopes. Sorting and failure rules
retain their current meanings. No filter action edits station favorites themselves.

Improve name priority, adjacent-transposition spelling tolerance, country/language
aliases, city/state and codec/bitrate matching. Normalize/cache search documents
without retaining stale mutated metadata. Ignore common in/from-style connecting
words only inside longer locale-appropriate queries; meaningful terms still match.
Exact names lead Best match even when unrelated metadata has a higher quality score.
Existing explicit bitrate/name/reliability and Recent/Similar order remain intentional.

## Boundaries

- No new dependency, search service, provider, tracking, credential or subscription.
- No new search-history storage or account document. Existing identity ownership stays.
- Preserve radios without coordinates and the current map/directory byte/deadline caps.
- Keep country expansion, failed-load retry, cached-directory recovery and SDR exclusion.
- Use deterministic bounded suggestions and input lengths; safe text DOM construction.
- Native select names, public helpers and runtime playback callbacks remain compatible.
- Keep the ivory/forest/copper presentation, 44px actions, wrapping and RTL/zoom support.
- Version maintained module URLs, fingerprint audited runtime edits, and advance shell.

## Acceptance

Prove that changing queries across entry points cannot combine stale queries; selecting
and clearing countries affects both pools; tags/languages/typos behave consistently;
rapid Enter and IME never select an earlier result; clear/reset actions remove exactly
their advertised constraints. Cover hidden filters, map/country conflicts, missing
facets, empty recovery, late catalog refresh, offscreen stations, and mobile keyboard
geometry. Existing station/map/playback/account/browser/native regressions must pass.

Use real browser layout review and bounded live directory searches separately from
fixtures. Delivery uses existing authorization for checked commits, CI, main, production,
matching desktop artifacts and Spaces. Local Windows signing and unnotarized Mac limits
remain accepted; no new charge may be selected without asking the owner.
