# Verified city and local-time foundation

This prerequisite supports the approved Today and place-first work. It adds a
small curated vocabulary and pure model without changing the current home, map,
player, directory loader, producer, account or sync entry points. Today, Passport,
broader city geocoding and country-badge rendering have separate acceptance work.

## Source data and licensing

The eleven city identifiers, proper names and reference coordinates come from
the existing hash-pinned [Natural Earth v5.1.2 populated-places data](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places_simple.geojson).
Its [terms](https://www.naturalearthdata.com/about/terms-of-use/) place the data in
the public domain. This simple dataset has no IANA timezone field.

The explicit city-to-zone selection is checked against
[IANA tzdb 2026f zone1970.tab](https://data.iana.org/time-zones/tzdb-2026f/zone1970.tab),
which maps zone identifiers to countries. The
[IANA license](https://data.iana.org/time-zones/tzdb-2026f/LICENSE) places these data
files in the public domain. No timezone implementation code is copied. These
data permit reuse without a data-license fee or per-query quota; normal hosting
and upstream download services retain their own operational limits. Earth Radio's
application licensing and existing component notices are unchanged.

[Selection](provenance/place-selection.json) fixes the Natural Earth IDs, explicit
IANA identifiers and order. [Data provenance](provenance/place-data.json) records
all four input byte counts/SHA-256 values, the selection hash and the generated
module hash. The generated module is 3,005 bytes and freezes its array, records,
point arrays and aliases. It does not load the large map modules.

IANA 2026f supplies the checked identifier/country mapping, not a bundled set of
clock-transition rules. Displayed offsets come from the host's `Intl`/ICU data.
The qualification host used Node 24.18.0, ICU 78.3 and timezone data 2026b; the
selected zones' tested winter/summer cases pass. Physical mobile/Mac clock and
installed-app acceptance are separate. No zone is calculated from longitude.

## Model contract

`stationPlace(station, places = CURATED_PLACES)` is pure. It requires a recognized
country code and reuses the existing coordinate/plausibility rules. Numeric
arrays, objects, booleans, blanks, out-of-range coordinates and Null Island do
not become a city. A country fallback point is never evidence for a city.

- `confidence: 'city'`: country, real directory point within a conservative 25 km
  candidate radius, and city/state or complete name-token evidence agree with one
  curated place. The result includes `cityId`, `city`, `timeZone`, the actual
  supplied point and `directory-coordinate-and-city-name` provenance.
- `confidence: 'exact'`: a valid supplied directory point remains, but no city is
  qualified. Here **exact means supplied coordinates**; it does not mean a verified
  physical broadcaster studio or independently calibrated positional accuracy.
- `confidence: 'country'`: only a known country is supported. The result has no
  invented city, timezone or point. Existing map presentation remains separate.
- `null`: location is unknown or the country is not recognized by the current
  model. Raw station fields and account documents remain unchanged.

The radius uses a documented spherical candidate calculation. It is neither a
municipal boundary nor an empirical accuracy claim. Explicit but unrecognized or
conflicting city evidence is not repaired by a nearby point or a station brand.
City-like state evidence has priority over a brand/genre name. Same-name matches
must resolve uniquely using country and coordinates; overlapping candidates are
left unresolved. The optional place-array argument is for trusted curated data
and controlled tests, not arbitrary station-supplied location claims.

`formatPlaceTime(place, instant, locale = 'en')` uses an explicit IANA identifier
and 24-hour `Intl.DateTimeFormat` output. An instant is finite epoch milliseconds,
a valid Date, or a valid ISO string with an explicit offset. Unsupported zones or
locales, invalid calendar dates and offset-free text return null; they never
silently use the current device's zone or clock.

```js
import {stationPlace, formatPlaceTime} from '../site/assets/place-core.js';
const place = stationPlace({countrycode:'KR', state:'Seoul',
  name:'CBS JOY4U', geo_lat:37.5683, geo_long:126.9978});
formatPlaceTime(place, '2026-01-15T12:00:00Z', 'en'); // 21:00
```

The modules perform no network request, geolocation/permission prompt, storage,
account mutation or implicit current-time lookup. No new listener-facing strings
or live UI flow are introduced by this prerequisite.

## Rebuild and check

Preconditions: use the repository's pinned Node/npm and locked dependencies. The
operator needs ordinary write access to the checkout; no key, elevated privilege,
provider subscription or database permission is required.

```powershell
# Explicit network operation: retrieve only fixed public, hash-pinned inputs.
node scripts/build-place-data.mjs --download
# Regenerate using retained local inputs, with no network operation.
node scripts/build-place-data.mjs
# Compare both outputs without writing; requires those pinned local inputs.
node scripts/build-place-data.mjs --check
```

Inputs cache under ignored `.build/place-input/`. Download and check are separate
operations. The builder rejects changed/missing input hashes, wrong-country zones,
duplicate IDs, invalid geometry and oversized selections. It writes only the
derived city module and provenance, plus the explicit download cache. It refuses
directory/file symlinks on those fixed paths. The module stays below 12 KiB.
Exit 0 means the requested generation/check succeeded; exit 1 is a validation or
I/O failure. Review updated official inputs in a separate change instead of silently
accepting a new upstream hash. Normal `npm run verify` checks committed data with
fixtures and hashes and does not fetch raw inputs.

## Offline coverage qualification

Provide a **local public directory snapshot**, not an account export or a URL:

```powershell
node scripts/qualify-place-data.mjs --input .build/place-time/live-catalog.json
```

The CLI accepts a legacy station array or schema2 groups, bounded to 16 MiB and
10,000 expanded records. It performs no fetch or DNS request and never changes its
input. It reports the input digest, model/dependency hashes and runtime versions.
Optional supplied generation/source fields are validated and labeled as supplied;
those fields alone do not establish upstream integrity. Exit 0 means a valid
report, not that all future availability or Today acceptance has been established.
Malformed/oversized input or I/O failure exits 1 without printing raw input values.

Existing family/stream grouping combines variants. Shared normalized stream URLs
and duplicate identities join groups transitively, so aliases cannot inflate city
totals. Conflicting supported cities/countries are excluded as ambiguous. At least
one corroborated variant supports each counted city program; partial variant
evidence is disclosed. Future Today selection must choose a matching variant and
retain the existing program/UUID aliases and explicit playback intent.

The [frozen local qualification](provenance/place-coverage.json) used the
integrity-checked generation `2026-11-11T11:22:15.959Z`, producer source
`87e353d690424d3bce4fbd0a596987fdac88a271`. The owned published-catalog reader
validated the SHA-bound descriptor and payload before local metadata was added
from its response headers. The receipt retains both raw and qualified-input hashes.

| City | Country | Program components with city evidence |
| --- | --- | ---: |
| Berlin | DE | 28 |
| Vienna | AT | 18 |
| New York | US | 25 |
| Madrid | ES | 13 |
| Istanbul | TR | 12 |
| London | GB | 22 |
| Toronto | CA | 7 |
| Dublin | IE | 6 |
| Jakarta | ID | 6 |
| Chicago | US | 6 |
| Seoul | KR | 5 |

The 10,000 identities form 9,422 directory groups and 9,400 conservative program
components. Confidence totals are 148 city, 2,251 supplied-coordinate, 6,921
country-only, 77 unknown and 3 ambiguous. Seven city components have partial
variant evidence. All eleven candidates meet five programs on this frozen input.
This small city set is a prerequisite, not the broader ER-16 60 percent coverage
target, an audio-availability test or a guarantee about future directory updates.

## Validation and rollback

```powershell
node --test tests/place-data.test.mjs tests/place-core.test.mjs tests/place-qualification.test.mjs
npm run verify
```

Tests cover provenance, source/zone disagreement, invalid geometry, token and
same-name ambiguity, country fallbacks, conflicting metadata, real points without
city evidence, DST/fractional offsets, invalid instants, device-zone independence,
alias/stream component counting, no hidden network calls and bounded file input.

Before UI integration, revert only this prerequisite's source/data/test/doc changes
and regenerate root release manifests. No account, schema or cache migration is
needed. After Today consumes it, roll back a coherent app deployment with a fresh
worker generation and separately versioned desktop builds. Preserve immutable
v0.32.2 tags/assets, original account data, SMTP/vault and prior release evidence.
