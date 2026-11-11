# 0.33.0 Today candidate qualification

PR46 merged and its served production bytes/headers/routes match. The subsequent
account-enabled production keyboard check exposed a hidden-account-modal guard
gap; delivery acceptance remains incomplete pending the
[0.33.1 correction](QA-0.33.1.md). The source qualification below describes its
observed runs and does not override that production finding.

This is an in-progress candidate record, not production acceptance. The base is
merged prerequisite `c874299`; pure calendar/native seeds are committed locally
as `c9a2a74` and the UI as `3037685`. Review fixes passed the full local gates
below before their commit. Published
0.32.2 assets and their tag remain unchanged.

## Scope and corrected defects

Today consumes the existing catalog and actions. It adds no audio element,
account store, provider, schema, permission, analytics, notification, paid resource
or dependency. City/zone data retain their frozen provenance and limitations.

| Finding | Correction and covering regressions |
| --- | --- |
| Skip link changed Today to Listen | Known focus anchors preserve destination; keyboard/viewport tests. |
| Rail text contrast was 1.256:1 | Established light rail ink; measured 4.5:1 minimum assertion. |
| A hero sibling repeated under On air | Exclude the entire program component; alias cases in both engines. |
| Midnight update discarded focused nodes | Reuse controls; UTC and focus tests. |
| Palette listener retained its old container | Same owner follows Settings; persistence/basemap tests. |
| Save could restore a stale hidden theme field | Palette selection aligns its existing field; Save/reload tests. |
| Advanced filters lost their visible entry | Original trigger remains in Refine; same inline Search on all widths. |
| Filter close lost focus or stole an outside target | Observe actual close; restore only focus owned by that surface. |
| Reload discarded search/Library state | Preserve reload/back context with station/filter routes; real timing and no-autoplay tests. |
| Idle label disagreed with a station link | Same selection precedence as footer transport; label/route/audio agree. |
| First user fragment was consumed after replaceState | Feedback flag applies only to real hash assignment; actual-runtime unit and geography/quality tests. |
| Early controls received clicks before binding | Disabled until handlers/data are ready; delayed-bundle/focus tests. |
| Library tabs crowded Search | Restrict to Library; full-row geometry/hit tests. |

Legacy tests now use real Library, Settings, Atlas and Search controls. List,
snapshot, variant and counter cases explicitly start the retained Listen fragment;
new launch cases use the actual root. No product fixture flag changes launch.
Row, tooltip, safe-area, timing and identity thresholds remain unchanged.

## Evidence so far

- Core full verify: 645 passing, three intentional skips; 414 committed hashes.
- Final local full verify: 650 passing, the same three skips, 421 hashes, plus
  lint/syntax, site and website validation. Windows skips are two POSIX child-pipe
  cases and symlink creation requiring an elevated policy; hosted OS checks remain.
- Full documented three-worker browser run: all 262 pass, including the original
  eight-second connection/pause case. This establishes that run's result, not the
  cause of the earlier four-worker diagnostic failure described below.
- Broad browser diagnostic at four workers: 260 of 261 passing. The remaining
  connection/pause case did not show its failure action within the unchanged
  eight-second assertion. Its cause is unestablished. Three isolated repetitions
  passed with the same limits; this does not establish that the parallel failure
  was fixed. Preserve its trace for final review and canonical qualification.
- Focused cases cover six locales, both palettes, 320–1440px widths, short rows,
  default/returning launch, real reload timing, named intent/retry, UTC rollover,
  no autoplay, focus and account-dialog access in Chromium/WebKit where supported.
  Media fixtures remain in Chromium.
- Installed-worker offline checks cover Today/model modules, original station
  browsing, privacy/404, no redirected index and no eager large-map precache.
  They do not qualify offline streaming.
- Rendered Electron matrix: all 42 scenarios pass after explicitly selecting their
  intended legacy contexts and using visible Settings entry points. Existing
  safe-area, overlap, row and locale limits remain. The last subsequent style
  change is scoped to Today titles, which have their own long-name browser case.
- Native Windows ARM64 sandbox/origin and auth/lifecycle checks pass in disposable
  profiles: owned frame, PKCE loopback, token-free renderer, encrypted restart,
  sync round-trip, sign-out failure recovery and quit flushing. Provider HTTP is
  synthetic; no personal profile or real provider identity was changed.

The retained 10,000-record model report keeps identical counts/example IDs after
component extraction. A 3,000-row root prefix needs 16 additions for five native
programs in each city, from one existing read. Istanbul has three HTTPS choices
and Seoul four in that sample. These are frozen data, not current uptime or
verified physical studio positions.

## Remaining gates

The final source review identified four P2 cases: sampled component evidence,
large accepted catalogs, skip-link route loss and Settings focus containment.
Their covering tests first failed. The candidate now carries bounded opt-in
native component/city support through normalization, admits the existing maximum
catalog, contains optional recommendation failure, preserves skip-link routes,
and contains Settings keyboard focus. Post-review local gates pass: 652 tests with
the same three Windows skips, 422 source hashes, all 274 browser cases at three
workers, all 42 rendered scenarios, and native ARM64 sandbox/auth/restart checks.
The native bridge case also covers an omitted conflicting city observation.
The broad-catalog test uses the actual root/country loader and map merge; a browser
case expands beyond 20,000 while retaining Search, Today and existing audio.

Local full verify, browsers, rendered matrix and native sandbox/auth/restart pass.
The fresh whole-branch review's four findings have covering RED-to-GREEN tests.
Require committed manifests, exact-head CI and actual preview
acceptance. Then merge, verify final-main/production and update
the Space. Desktop distribution requires a separate immutable artifact build
and qualification after phase3 UI acceptance.

Live provider sign-in, physical mobile devices, installed desktop upgrades,
public Windows trust and Apple notarization are not established by fixtures.
Existing accepted local-signing/unnotarized policy remains unchanged. Contracts,
preconditions and rollback are in [Today](TODAY.md) and the release runbooks.
