# Normalized directory implementation plan

> For agentic workers: use superpowers:executing-plans sequentially. Do not create
> implementation subagents. Independent review follows the existing review skill.

**Goal:** deliver grouped station selection and scheduled normalized snapshots,
and close the toast, Antarctic fallback and injected-beacon regressions.

**Architecture:** a bounded Node producer publishes content-addressed JSON and a
manifest through a GitHub Pages static artifact. The existing Pages reader serves that
generation; the existing renderer retains raw UUID lookup and uses a grouped view.

**Tech stack:** existing Node 24/npm, vanilla modules, Leaflet, Electron, Pages and
public GitHub Actions. No additional package or paid resource.

**Spec:** `docs/superpowers/specs/2026-11-08-normalized-directory-design.md`.

## Constraints and gates

- Preserve all original stream/alias UUIDs, account documents and favorite intent.
- New grouped responses are versioned; legacy responses retain their array shape.
- Country inference needs positive nonconflicting evidence; approximation stays out
  of stored coordinates and precise area filtering.
- Public URL/body/record bounds, strict-public egress, absolute deadlines and stale
  fallback remain mandatory. Never log credentials, full auth URLs or signed keys.
- All implementation commits remain gated by relevant local tests. Merge only after
  exact-head checks; production and desktop publication require their own readbacks.

## Task 1: regressions

Files: `site/assets/station-location.js`, new `site/assets/map-viewport.js`, runtime
map/load adapter, `site/assets/responsive-ui.css`, matching recovered references,
`tests/station-location.test.mjs`, new `tests/map-viewport.test.mjs`, and
`tests/e2e/directory-snapshot.spec.mjs`.

- [ ] Add failing AQ/no-coordinate and latitude-bound tests.
- [ ] Implement `minimumAtlasZoom(height)` and `installMapViewport(map)` with a
  resize-aware min zoom, bounded center and teardown. Emit only public view bounds
  as an in-process `earthradio:map-viewport` event for integration verification.
- [ ] Remove only catalog-success toast calls; retain error/action notifications.
  Anchor the general toast container above player/nav with pointer-events disabled.
- [ ] Test startup notification history, button hit-testing, real map bounds and
  resize/zoom behavior in Chromium/WebKit.

```powershell
node --test tests/station-location.test.mjs tests/map-viewport.test.mjs
npm run test:e2e -- --workers=3 --grep 'catalog status|atlas latitude'
```

## Task 2: normalized generation

Files: new `site/assets/station-variants.js`, `scripts/directory-normalize.mjs`,
`scripts/build-directory-snapshot.mjs`, `scripts/publish-directory-snapshot.mjs`,
`.github/workflows/directory-snapshot.yml`, and focused tests.

- [ ] Define `groupStationVariants(stations)` returning stable keys, representative
  station, distinct streams and every member/alias ID. Define `expandVariantGroups`
  as the legacy UUID-addressable projection. Test deterministic ordering, Unicode,
  state/country conflicts, same-URL aliases and quality disagreements.
- [ ] Define `normalizeDirectory(rows)` with bounded fields, canonical country/tag
  metadata, safe URL rejection, declared transport and normalization counts. Test
  malformed data, unknown/conflicting countries, HTTP streams and credential URLs.
- [ ] Build legacy/grouped global and bounded country files with a validated manifest
  whose hashes identify exact UTF-8 bytes. Keep metadata generation time separate
  from the content ETag. Validate the whole generation before publishing anything.
- [x] Validate every manifest-referenced file and publish an atomic static artifact
  without writing source branches. Reject unexpected keys, hash mismatches and
  output replacement. Test failure/rollback guards.
- [x] Add an hourly/manual workflow with pinned official actions, ephemeral Pages
  and OIDC deployment permission, read-only source access and no saved secret.

## Task 3: reader and client

Files: `functions/_shared/directory-snapshot.js`, new snapshot protocol helper,
`site/assets/directory-client.js`, `site/assets/directory-expansion.js`,
`server/desktop-proxy.mjs`, runtime load/status adapter, and tests.

- [ ] Stream validated content-addressed published files with stable ETags and
  generation headers; retain cache/stale/time/byte/key limits and finite routes.
- [ ] Keep v1 compatibility; validate v2 before expanding its stream/alias records.
  Preserve snapshot metadata through local cache, native response and status UI.
- [ ] Normalize native/direct fallback data through the same model without bypassing
  DNS/IP pinning. Exercise published data with every provider host unavailable.
- [ ] Show snapshot update/stale status, country inference and HTTP-only badges.

## Task 4: grouped interaction

Files: discovery UI/core, search controls, runtime card/palette/map/player adapters,
existing discovery/listening-room CSS, locales, and regression suites.

- [ ] Rank matching streams, then project one group result across Browse/Search/map.
  Preserve Favorites/Recent/Similar semantics and direct lookup of every UUID.
- [ ] Add keyboard-accessible quality selection with no autoplay before Play,
  retained focus, appropriate labels and bounded sibling recovery.
- [ ] Test legacy deep links, alias favorites, quality change while playing/paused,
  failed sibling variants, search/filter resets and concurrent catalog refreshes.
- [ ] Use an outline favorite off-state and station-specific labels on touched cards;
  remove misleading external arrows from touched in-app actions.

## Task 5: hosted and release qualification

- [x] Qualify the publisher prerequisite with local verification, independent review
  and ten exact-head CI checks (PR #33). Enable free GitHub Pages workflow deployment.
- [ ] Prepare and review the grouped-reader candidate. Suppress
  automatic beacon injection using the existing no-transform document policy;
  preserve the self-only CSP and analytics history.
- [x] Bootstrap data from committed main (09e553c, run 42559123011); verify the public
  artifact hashes, enabled schedule, legacy/grouped data and live reader 200/304.
- [ ] Qualify the new reader in preview and dispatch its updated producer from final
  main; verify atomic data-only publication and stable content identity.
- [ ] Run `npm run verify`, full E2E/rendered/native/auth gates, advisory audit and
  independent review; require all exact-head checks before merge and final-main CI.
- [ ] Compare production bytes/headers, stable ETags/generation time and retained
  account state. Rebuild/sign Windows locally and qualify both Mac CI DMGs from the
  final commit. Publish a new release only after payload/source/hash checks pass.
- [ ] Verify all draft/anonymous downloads, installation links and Spaces preservation.
  Keep physical-device, outside-account, signing and audio-fidelity limits explicit.
