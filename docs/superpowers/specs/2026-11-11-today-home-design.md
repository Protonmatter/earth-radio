# Today home and bounded city sampling

The owner approved ER-03 after the city/time prerequisite, delegates design choices
and asks for questions only for new cost. This change makes the first screen useful
for returning listeners without adding a second audio player, catalog, account
store or map. ER-05's place-first station rows and later Passport/atlas/SEO remain
separate PRs. The accepted cream/pine/copper identity and serif wordmark stay.

## User-visible result

Atlas is the home destination. Desktop pairs a quiet Today panel with the actual
existing map. Mobile shows a map preview above a compact Today sheet. The first
390x844 viewport must show Continue when history exists and Today's place, each
with a named play action and no menu or scroll. On air now offers a small set of
other station programs; it does not make background metadata/API requests.

Today's place names one curated city, its localized country and local time. Its
main action names the actual station it will select. Continue uses the existing
runtime's current/last-played station and existing persistence; it stays absent
without history. An idle footer offers Continue or the day's station, rather than
a dead Select a station control. No playback occurs before an explicit action.

Primary navigation is Atlas, Library and Search. Library groups existing favorites,
recent stations, songs and account views. Existing internal listen/search/map/saved/
you destinations remain compatible; add today for home. A full-map action preserves
the current map tools. Keep existing settings/import/export/refresh/theme owners,
and place low-frequency controls in Settings. Remove visible duplicated overflow
actions; preserve required runtime element IDs and handlers rather than creating
parallel stores/controllers. Skip-to-content and modal focus must remain usable.

Fresh launch opens Today unless an explicit supported navigation/station deep link
requests another view. Preserve locale, palette, split, favorites, recent, song and
account data. Explicit station links remain one-tap ready and never autoplay.
Library's existing saved-segment preference stays; new presentation subpanes need
no new cloud schema or collection migration.

## Date, choice and playback authority

Use a separately frozen v1 calendar list of the eleven qualified Natural Earth IDs.
UTC date alone chooses its index, independent of locale, filters, row order, health
or device timezone. Adding/reordering general place data cannot change this list.
Invalid/missing date/place data yields an honest unavailable state, not another city.
Update the displayed date/time at least once a minute and on foregrounding. Midnight
may update recommendations but cannot change, pause or retarget current audio.

Use the qualified model and one conservative family/shared-stream program model
for candidate counting. Prefer the existing reliability/secure-stream ranker. Five
means five program components with matched city evidence, not five UUID aliases.
Current/last-station and source catalog are supplied by a narrow runtime adapter.
The chosen hero station stays stable during a date/catalog revision, especially
after a failed attempt; Retry cannot silently select another program.

All play actions call the existing station-intent entry point. Pause uses its
existing owner. Preserve the 7.5-second sibling budget, selection/hash/player/media
identity, trusted-playing counters and explicit World Scan permission. Do not
write history/counters while rendering or choosing a recommendation. Low/no data
gets disabled named controls and an explicit existing refresh/browse path.

## Native sample and common pure logic

The checked native root prefix contains Dublin0, Istanbul3 and Jakarta3 programs;
those countries are outside the default seven supplements. Use its already
downloaded full root to supply up to five matching program representatives per
calendar city, at most55 additions, preserving the existing prefix and original
identities. No extra directory request, provider, location permission or resource.

Make native enrichment opt-in on the application's existing federated request
(`placeSeeds=1`); default endpoint behavior and limits remain compatible. Reject
invalid flag values. Extract a small pure program-component helper shared with
the offline qualifier, preserving its conflicting-duplicate validation and frozen
results. Test equivalence and refresh byte-bound model provenance after extraction.
Match city-qualified variants explicitly; partial component evidence is not a
license to choose a sibling without supported place metadata for the recommendation.

## Presentation and rollout

Use one new Today stylesheet loaded after current presentation styles, scoped to
the new views. Keep original artwork/map, no decorative generated imagery, noise,
new font service, dependency, analytics, notification, geocoder or paid resource.
Touch targets are at least44px, text/focus readable in both palettes and six locales,
clock updates are quiet for screen readers, and reduced-motion users get no new
animation. First-viewport default layout must not cover the player or map controls.
Necessary overflow at enlarged text/short windows must remain scrollable, not clipped.

Wire a maintained Today UI module through the existing dashboard adapter/snapshot
calls (`ra`, `ia`, `ac` in the selected runtime). Preserve sole engine ownership and
update the source/provenance description honestly; src-recovered is a reference,
not a reproducible compiler source. Candidate version0.33.0 and a fresh coherent
worker/module generation are required when active consumers change. Keep large map
layers out of the precache. Previous v0.32.2 assets/tag remain immutable; the next
desktop release follows phase3's UI acceptance, including ER-05.

## Acceptance

- New and returning390x844 launch, all six locales, Paper/Night, keyboard/skip link,
  text zoom, small/large windows and modal back/focus preserve usable controls.
- Continue/Today reach the named station in one tap through existing intent, no
  autoplay, no hidden cross-program attempt, and one confirmed-play counter.
- Same UTC date is the same city across locales/TZ/array order; rollover changes
  the day without changing current audio or stationary history/counter state.
- Cached snapshot plus coherent shell renders modules offline without trying to
  claim offline audio or online station availability.
- Native opt-in yields five matched programs per available calendar city from the
  existing root, preserves prefix/IDs/budgets and issues no additional read.
- All meaningful existing search/filter/loading/grouping/playback/auth/sync tests
  remain. Update list-focused tests to navigate to Search explicitly; never weaken
  geometry/identity/ownership assertions to accommodate the new default home.
- Full verify/browser/rendered/native CI, fresh whole-branch review and exact-head
  deployed preview qualification pass before authorized merge/deploy/Spaces update.
