# Bundled atlas data

The listening atlas replaces the previous CARTO raster basemap with bundled Natural Earth land geometry. The existing Leaflet engine handles panning, zoom, marker clustering, and interaction. The basemap makes no external tile, geocoding, location, or provider API requests.

- Dataset: Natural Earth 1:110m land, release **v5.1.2**.
- Source: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson
- Source repository: https://github.com/nvkelso/natural-earth-vector
- Terms: https://www.naturalearthdata.com/about/terms-of-use/
- Retrieved: 2026-11-03.
- Source length: 138,160 bytes.
- Source SHA-256: `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`.
- Transformation: preserve all 127 land features and their polygon/ring structure; remove descriptive properties; round coordinates to three decimal degrees; serialize compactly as the `WORLD_LAND` export in `site/assets/world-land.js`.
- Bundled size at introduction: 96,439 bytes including the module wrapper.

Natural Earth's terms place its vector and raster map data in the public domain. The map shows a voluntary "Made with Natural Earth" attribution. This data attribution does not change the application's licensing.

The layer is deliberately a global radio-discovery atlas, not a street map. Zoom is limited to 1–7 because the source is generalized at 1:110m. Coastline precision, tiny islands, and inland details are limited. The data contains land outlines rather than political borders or geocoded station locations; station locations still come from the directory, and missing/invalid coordinates are never fabricated.

The basemap is drawn in a noninteractive Leaflet pane beneath station markers, using existing Night/Paper palette controls. Graticules and geography work without tile connectivity after the application shell has been cached. Internet connectivity is still needed for fresh directories and live radio streams.

Before replacing this dataset, verify the source version and terms, review geometry bounds/rings and resulting file size, update this provenance, bump the service-worker generation, regenerate release hashes, and run the discovery browser suite. Keep all imported data local rather than adding a runtime provider dependency without a separate decision.
