// Pure geography presentation rules. No network, storage, DOM or playback state.
export const MAP_LABEL_STORAGE = 'earthRadio.mapLabels.v1';

export function sanitizeMapLabels(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return { countries: raw.countries !== false, cities: raw.cities !== false };
}

export function resolveMapTheme(palette, requested = 'dark') {
  return palette === 'paper' ? 'light' : palette === 'night' ? 'dark' : requested === 'light' ? 'light' : 'dark';
}

export function intersectsBounds(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function labelName(label, locale = 'en') {
  return label.names?.[locale] || label.name;
}

export function labelWidth(text, kind) {
  const units = [...String(text)].reduce((sum, character) => sum + (/[\u2e80-\u9fff\uac00-\ud7af]/u.test(character) ? 12 : kind === 'country' ? 7.4 : 6.8), 0);
  return Math.min(kind === 'country' ? 240 : 210, Math.max(24, Math.ceil(units + (kind === 'city' ? 12 : 8))));
}

// Labels use fixed CSS boxes matching these bounds, so decluttering does not
// depend on platform font metrics or a delayed animation frame. Important
// country/capital/population ranks are supplied by Natural Earth, not inferred.
export function layoutMapLabels(labels, { zoom, width, height, project, locale = 'en', countries = true, cities = true, limit = 160 }) {
  const accepted = [], cells = new Map(), cellSize = 64;
  for (const label of labels) {
    if (label.minZoom > zoom || (label.kind === 'country' ? !countries : !cities)) continue;
    const point = project(label.point);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const name = labelName(label, locale), boxWidth = labelWidth(name, label.kind), boxHeight = label.kind === 'country' ? 20 : 18;
    const anchorX = label.kind === 'country' ? boxWidth / 2 : locale === 'ar' ? boxWidth - 2 : 2;
    const left = point.x - anchorX, top = point.y - boxHeight / 2;
    const box = [left - 4, top - 3, left + boxWidth + 4, top + boxHeight + 3];
    if (box[0] < 4 || box[1] < 4 || box[2] > width - 4 || box[3] > height - 4) continue;
    const keys = [];
    for (let x = Math.floor(box[0] / cellSize); x <= Math.floor(box[2] / cellSize); x++) {
      for (let y = Math.floor(box[1] / cellSize); y <= Math.floor(box[3] / cellSize); y++) keys.push(`${x}:${y}`);
    }
    if (keys.some(key => (cells.get(key) || []).some(other => intersectsBounds(box, other)))) continue;
    accepted.push({ label, name, width: boxWidth, height: boxHeight, anchorX });
    for (const key of keys) { if (!cells.has(key)) cells.set(key, []); cells.get(key).push(box); }
    if (accepted.length >= limit) break;
  }
  return accepted;
}

const exactKeys = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) &&
  Object.keys(object).sort().join(',') === keys.slice().sort().join(',');
const bounded = (number, low, high) => Number.isFinite(number) && number >= low && number <= high;
const text = (value, length = 160) => typeof value === 'string' && value.length > 0 && value.length <= length && !/[\u0000-\u001f<>]/u.test(value);

// The build and deployment validator both call this before exempting numeric
// coordinates from the local-address scanner. No arbitrary code/properties can
// hide behind a map-data filename. The runtime imports only these bundled files.
export function validateMapData(data, kind) {
  const world = kind === 'world';
  if (!exactKeys(data, world ? ['schemaVersion', 'countries', 'water', 'labels'] : ['schemaVersion', 'countries', 'water', 'lines']) || data.schemaVersion !== 1) throw new Error('Invalid map envelope');
  let points = 0, currentBounds = null;
  const point = value => {
    if (++points > 2500000 || !Array.isArray(value) || value.length !== 2 || !bounded(value[0], -180, 180) || !bounded(value[1], -90, 90)) throw new Error('Invalid map coordinate');
    if (currentBounds && (value[0] < currentBounds[0] || value[0] > currentBounds[2] || value[1] < currentBounds[1] || value[1] > currentBounds[3])) throw new Error('Map bounds do not contain geometry');
  };
  const line = (value, ring = false) => {
    if (!Array.isArray(value) || value.length < (ring ? 4 : 2)) throw new Error('Invalid map line');
    value.forEach(point);
    if (ring && (value[0][0] !== value.at(-1)[0] || value[0][1] !== value.at(-1)[1])) throw new Error('Open map ring');
  };
  for (const key of world ? ['countries', 'water'] : ['countries', 'water', 'lines']) {
    const collection = data[key];
    if (!exactKeys(collection, ['type', 'features']) || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features) || collection.features.length > 50000) throw new Error('Invalid map collection');
    for (const [index, feature] of collection.features.entries()) {
      if (!exactKeys(feature, ['type', 'properties', 'geometry']) || feature.type !== 'Feature' || !exactKeys(feature.properties, ['minZoom', 'bounds', 'kind']) ||
          !bounded(feature.properties.minZoom, 0, 12) || !['country', 'lake', 'river', 'road', 'region'].includes(feature.properties.kind) ||
          !Array.isArray(feature.properties.bounds) || feature.properties.bounds.length !== 4 ||
          !feature.properties.bounds.every((value, index) => bounded(value, index % 2 ? -90 : -180, index % 2 ? 90 : 180)) ||
          feature.properties.bounds[0] > feature.properties.bounds[2] || feature.properties.bounds[1] > feature.properties.bounds[3] ||
          !exactKeys(feature.geometry, ['type', 'coordinates'])) throw new Error(`Invalid map feature in ${key} at ${index}`);
      if (key === 'countries' && feature.properties.kind !== 'country' || key === 'water' && feature.properties.kind !== 'lake' ||
          key === 'lines' && !['river', 'road', 'region'].includes(feature.properties.kind)) throw new Error('Mismatched map feature kind');
      currentBounds = feature.properties.bounds;
      const g = feature.geometry;
      if (key === 'lines' && !['LineString', 'MultiLineString'].includes(g.type) || key !== 'lines' && !['Polygon', 'MultiPolygon'].includes(g.type)) throw new Error('Invalid map geometry type');
      if (g.type === 'LineString') line(g.coordinates);
      else if (g.type === 'MultiLineString') { if (!Array.isArray(g.coordinates) || !g.coordinates.length) throw new Error('Empty map geometry'); g.coordinates.forEach(value => line(value)); }
      else {
        const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        if (!Array.isArray(polygons) || !polygons.length) throw new Error('Empty map polygons');
        for (const polygon of polygons) { if (!Array.isArray(polygon) || !polygon.length) throw new Error('Empty map polygon'); polygon.forEach(value => line(value, true)); }
      }
    }
  }
  currentBounds = null;
  if (world) {
    if (!Array.isArray(data.labels) || data.labels.length > 10000) throw new Error('Invalid map labels');
    for (const label of data.labels) {
      if (!exactKeys(label, ['id', 'kind', 'name', 'names', 'point', 'minZoom', 'rank', 'population']) || !text(label.id, 40) || !text(label.name) ||
          !['country', 'city'].includes(label.kind) || !bounded(label.minZoom, 0, 12) || !bounded(label.rank, 0, 100) || !bounded(label.population, 0, 2e9) ||
          !label.names || typeof label.names !== 'object' || Array.isArray(label.names) || Object.keys(label.names).some(key => !['en', 'es', 'ar', 'ko', 'zh-Hans', 'zh-Hant'].includes(key)) ||
          Object.values(label.names).some(value => !text(value))) throw new Error('Invalid map label');
      point(label.point);
    }
  }
  return data;
}
