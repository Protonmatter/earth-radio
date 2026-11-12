# Bundled geographic atlas

Earth Radio 0.28.0 draws a local geographic map using the existing Leaflet 1.9.4
engine. Country and city labels have independent switches in **Map labels**;
preferences are remembered on this device, independently of account sync. Zoom
reveals more names, country/regional borders, lakes, rivers and selected roads.
Labels are priority ordered and collision checked before rendering. They cannot
capture station pointer or keyboard input.

All geography comes from Natural Earth **v5.1.2**. Its [terms](https://www.naturalearthdata.com/about/terms-of-use/)
place vector and raster data in the public domain, permitting commercial use,
modification and redistribution without a data license fee or request quota.
Leaflet uses BSD-2-Clause and markercluster uses MIT; their notices and the data
attribution ship in [map-data-notices.txt](../site/map-data-notices.txt). These
component/data terms do not change Earth Radio's application licensing.
No tile server, map subscription, provider key, geocoder, GPS request or new npm
dependency is used. Ordinary application hosting still has its own limits.

## Sources and transformations

[The source manifest](provenance/map-data.json) pins seven upstream GeoJSON files
by URL, byte length and SHA-256: 1:50m countries for the overview; 1:10m countries,
populated places, administrative boundaries, lakes, rivers and roads for detail.
Country names include the six supported application languages where the dataset
provides them. City names retain their source proper names.

The deterministic curator rounds to four decimal degrees, simplifies lines with
an iterative Ramer-Douglas-Peucker algorithm, preserves closed polygon rings and
bounds, and removes descriptive properties except the explicit rendering schema.
It omits two empty source geometries (one regional boundary and one river) rather
than inventing coordinates. Unknown/ferry road classes are omitted.

| Bundled module | Contents | Approximate size | Loaded at |
| --- | --- | --- | --- |
| map-world.js | 242 countries, 46 major lakes, 258 country labels, 7,342 cities | 2.8 MB | Overview |
| map-detail.js | 258 countries and 1,355 lakes | 10.6 MB | Zoom 4 |
| map-terrain.js | 1,201 rivers and 10,178 regional boundaries | 8.8 MB | Zoom 5 |
| map-roads.js | 30,481 selected road lines | 9.8 MB | Zoom 6 |

Every module stays below the 16 MiB curation cap. Detailed features are filtered to
the viewport and source minimum zoom, then drawn on a noninteractive canvas. The
initial overview uses SVG country polygons. Large map modules now have content-hashed
filenames and immutable cache rules. They load by zoom and cache after use; service
worker installation caches only the small coastline fallback. Fresh directories,
streams and sync still need internet.
If a module cannot load, the overview/fallback remains usable, a status message
explains the missing detail, and station loading/search remain available.

This is generalized geographic data, not a navigation product. Natural Earth does
not supply all local streets, building addresses, traffic or routing. Zoom is
bounded to 1–10 and city labels are decluttered. Coastline precision and coverage
vary with scale. Political boundaries follow Natural Earth's cartographic choices;
they do not imply endorsement. Stations with plausible directory coordinates use
those points. Missing or clearly inconsistent positions use a dashed, explicitly
approximate country reference marker; no approximate coordinates are written into
station records, account data or precise map-area filters. See
[directory/search/map reliability](DISCOVERY_RELIABILITY.md) for derivation and limits.

## Rebuild and validation

Listening Passport uses a separate 2,793-byte country identifier index, generated
from the same pinned country inputs and checked against every existing serialized
polygon. It preserves the four large modules and their immutable cache URLs.
`ISO_A2_EH` then `ISO_A2` supply identities; unidentified polygons stay blank and
postal abbreviations are never used. Passport shades actual country polygons,
clears on history/account changes and requests no extra map detail. It does not
represent the listener's physical location. See [Passport](PASSPORT.md) and
[identifier provenance](provenance/map-country-identifiers.json).

Reproduce that small index from already downloaded, hash-checked source files:

```powershell
node scripts/build-map-country-identifiers.mjs "--source-dir=C:\path\to\map-source"
node --test tests/passport-map.test.mjs
```

Normal web/desktop builds use committed curated assets without upstream downloads.
To reproduce them from the pinned sources, run from the repository root:

```powershell
node scripts/build-map-data.mjs --download
node --test tests/map-atlas.test.mjs
npm run verify
npm run test:e2e
npm run test:rendered
```

The first command downloads and hash-checks inputs under ignored `.build/map-source/`.
Omit `--download` to rebuild from those existing verified inputs. It prints output
sizes/hashes; unchanged pinned inputs must reproduce the committed output hashes.
Tests strictly parse data-only exports, validate every coordinate/ring/bound/schema,
and compare output hashes with provenance. CI does not need a live upstream source.

Before changing data or its curator, review terms, sources, output sizes, omissions,
geometry and label priorities. Update provenance, the service-worker generation,
release hashes and documentation, and run station loading, area search, tooltip,
label toggle/persistence, palette, RTL and failure-path regressions.
For rollback, restore the previous verified application/data set with a newer
service-worker generation; retain the guarded Functions and private metadata quota
binding. A local label preference can simply be changed in Map labels.
