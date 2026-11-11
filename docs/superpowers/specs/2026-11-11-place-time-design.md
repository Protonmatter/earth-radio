# Verified city and IANA-time foundation

The owner approved the daily-return delivery order and delegated implementation
choices, asking for questions only when new cost is incurred. This prerequisite
supports ER-03 Today and ER-05 place-first presentation. It does not claim full
ER-16 geocoding coverage or introduce Today UI before its separate acceptance.

## Intent and constraints

Give subsequent UI a small, trustworthy city/time vocabulary while preserving
the approved brand, directory availability, UUID aliases, account identities,
sync, playback and immutable releases. Use the current Node/npm toolchain and
existing modules. No dependency, paid resource, runtime network request, permission,
account/schema/provider/vault change, analytics or notification subscription.

The initial dataset contains eleven Natural Earth places supported by at least
five corroborated program groups in the integrity-verified November 11 snapshot:
Berlin, Vienna, New York, Madrid, Istanbul, London, Toronto, Dublin, Jakarta,
Chicago and Seoul. Their identifiers, source coordinates and proper names come
from the existing hash-pinned Natural Earth v5.1.2 populated-places input. Curate
explicit IANA zones against a separately hash-pinned zone1970.tab; this Natural
Earth dataset contains no IANA field. Both data sources are public domain. Preserve
Earth Radio's existing application licensing and component notices.

## Approaches and decisions

A broad automatic gazetteer rollout can improve coverage later but would couple
the daily home prerequisite to substantial ambiguous-data work. A country-centroid
or longitude/time-offset shortcut would manufacture city/time precision. The
selected approach is a small explicit source-backed city set with conservative
coordinate/name agreement. The set, 25 km candidate radius and API names are
engineering choices, not details separately specified by the owner.

Use a deterministic generator with explicit optional input download and checked
hashes. Regular builds/tests use the committed small output and make no requests.
Keep the new modules off the active renderer path until Today consumes them.

## Interfaces and honest confidence

`CURATED_PLACES` contains frozen records: `id`, `naturalEarthId`, `name`,
`countrycode`, `point` as `[latitude, longitude]`, `timeZone`, `aliases`.
IDs derive from Natural Earth IDs; ordered selection is frozen for a future Today
calendar. A generated provenance record pins inputs and output bytes/SHA-256.

`stationPlace(station, places = CURATED_PLACES)` is pure and does not alter raw
fields. Reuse `stationLocation` validation. A city requires the same known country,
actual directory coordinates within the documented 25 km candidate radius, and
corroborating city/state or name tokens. A country fallback point cannot qualify.
Reject multiple candidates and conflicting explicit city evidence. Same-name
places require the correct country and coordinate agreement; absence of a match
must never guess another place.

Return `confidence: city` with stable city ID/name, explicit zone, actual point and
coordinate/name provenance when qualified. A valid directory point without a
qualified city remains `confidence: exact`, explicitly meaning supplied directory
coordinates, not independently verified studio accuracy. Known country-only data
is `confidence: country` without an invented city/time zone. Unknown location is
explicitly absent. The radius is a conservative candidate rule, not a municipal
boundary, measured empirical calibration or assurance of physical broadcaster site.

`formatPlaceTime(place, instant, locale = en)` uses the place's explicit IANA zone
and `Intl.DateTimeFormat` with 24-hour output. Require an explicit instant (finite
epoch milliseconds, valid Date or ISO text with an explicit offset). Invalid dates,
zones/locales or a missing zone return null; never silently use device-local time.

## Qualification and rollout

Generator tests cover source/country/zone mismatch, invalid geometry, duplicate
IDs, deterministic output and bounded input. Model tests cover country centroids,
unknown/wrong countries, malformed/boolean/blank coordinates, 0,0, city-name token
boundaries, conflicting names, same-name cities, input immutability, DST/non-hour
offsets, invalid zones/instants and device-zone independence.

Measure coverage from a supplied public snapshot JSON with no default network
access; group variants before counting cities and retain provenance. Five-program
counts qualify the frozen input, not all future upstream availability. Broader
coverage and the guessed 60 percent target stay in ER-16. Native truncation and
minimum city seeds require separate investigation before Today is implemented.

Run focused tests, npm run verify, exact-head CI and a fresh whole-branch review.
Rollback this unused prerequisite by reverting its commits and regenerating root
manifests. Do not retarget the existing v0.32.2 tag or replace downloads.
