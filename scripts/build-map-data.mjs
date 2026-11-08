// Deterministic Natural Earth curation. Normal application builds use committed
// data. --download explicitly retrieves the pinned, hash-checked upstream inputs.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMapData } from '../site/assets/map-core.js';

const root = path.resolve(import.meta.dirname, '..');
const digest = data => createHash('sha256').update(data).digest('hex');
const clamp = (value, low, high) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : low));
const roundPoint = point => {
  if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(Number.isFinite) || Math.abs(point[0]) > 180.00001 || Math.abs(point[1]) > 90.00001) throw new Error('Invalid source coordinate');
  return [Math.round(clamp(point[0], -180, 180) * 10000) / 10000, Math.round(clamp(point[1], -90, 90) * 10000) / 10000];
};

export function simplifyLine(points, tolerance, ring = false) {
  if (!Array.isArray(points) || points.length < (ring ? 4 : 2) || points.some(p => !Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(Number.isFinite))) throw new Error('Invalid source line');
  const keep = new Uint8Array(points.length), stack = [[0, points.length - 1]], threshold = tolerance ** 2;
  keep[0] = keep[points.length - 1] = 1;
  while (stack.length) {
    const [start, end] = stack.pop(), a = points[start], b = points[end];
    const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
    let farthest = -1, distance = threshold;
    for (let index = start + 1; index < end; index++) {
      const p = points[index], t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
      const d = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
      if (d > distance) { distance = d; farthest = index; }
    }
    if (farthest >= 0) { keep[farthest] = 1; stack.push([start, farthest], [farthest, end]); }
  }
  let result = points.filter((_, index) => keep[index]).map(roundPoint);
  result = result.filter((p, index) => !index || p[0] !== result[index - 1][0] || p[1] !== result[index - 1][1]);
  if (ring) {
    if (result[0][0] !== result.at(-1)[0] || result[0][1] !== result.at(-1)[1]) result.push([...result[0]]);
    // Retain small source islands/holes rather than replacing their topology
    // with an invalid two-point polygon after simplification.
    if (result.length < 4) result = points.map(roundPoint);
  } else if (result.length < 2) result = [roundPoint(points[0]), roundPoint(points.at(-1))];
  return result;
}

export function curateGeometry(geometry, tolerance) {
  const { type, coordinates } = geometry;
  if (type === 'LineString') return { type, coordinates: simplifyLine(coordinates, tolerance) };
  if (type === 'MultiLineString') return { type, coordinates: coordinates.map(line => simplifyLine(line, tolerance)) };
  if (type === 'Polygon') return { type, coordinates: coordinates.map(ring => simplifyLine(ring, tolerance, true)) };
  if (type === 'MultiPolygon') return { type, coordinates: coordinates.map(polygon => polygon.map(ring => simplifyLine(ring, tolerance, true))) };
  throw new Error('Unsupported source geometry');
}

function bounds(geometry) {
  const result = [180, 90, -180, -90];
  const visit = value => {
    if (typeof value[0] === 'number') {
      result[0] = Math.min(result[0], value[0]); result[1] = Math.min(result[1], value[1]);
      result[2] = Math.max(result[2], value[0]); result[3] = Math.max(result[3], value[1]);
    } else value.forEach(visit);
  };
  visit(geometry.coordinates); return result;
}

function feature(raw, kind, tolerance, minZoom = 0) {
  const geometry = curateGeometry(raw.geometry, tolerance);
  return { type: 'Feature', properties: { kind, minZoom: clamp(minZoom, 0, 10), bounds: bounds(geometry) }, geometry };
}
const collection = features => ({ type: 'FeatureCollection', features });

export function curateMapData(source) {
  const hasGeometry = item => {
    if (!item.geometry) return false;
    if (!Array.isArray(item.geometry.coordinates)) throw new Error('Invalid source geometry envelope');
    const hasPoint = coordinates => typeof coordinates[0] === 'number' || coordinates.some(hasPoint);
    return hasPoint(item.geometry.coordinates);
  };
  const features = name => source[name].features.filter(hasGeometry);
  const countrySource = features('ne_10m_admin_0_countries');
  const labels = countrySource.map((item, index) => {
    const p = item.properties;
    const names = Object.fromEntries([['en', 'NAME_EN'], ['es', 'NAME_ES'], ['ar', 'NAME_AR'], ['ko', 'NAME_KO'], ['zh-Hans', 'NAME_ZH'], ['zh-Hant', 'NAME_ZHT']]
      .filter(([, key]) => typeof p[key] === 'string' && p[key]).map(([locale, key]) => [locale, p[key]]));
    return { id: `country-${index}`, kind: 'country', name: p.NAME_EN || p.NAME,
      names, point: roundPoint([p.LABEL_X, p.LABEL_Y]), minZoom: clamp(Number(p.MIN_LABEL) - 1, 1, 8),
      rank: clamp(p.LABELRANK, 0, 100), population: clamp(p.POP_EST, 0, 2e9) };
  });
  for (const [index, item] of features('ne_10m_populated_places_simple').entries()) {
    const p = item.properties;
    labels.push({ id: `city-${index}`, kind: 'city', name: p.name || p.nameascii,
      names: {}, point: roundPoint(item.geometry.coordinates), minZoom: clamp(p.min_zoom, 3, 10),
      rank: clamp(p.scalerank, 0, 100), population: clamp(p.pop_max, 0, 2e9) });
  }
  labels.sort((a, b) => (a.kind === 'country' ? 0 : 1) - (b.kind === 'country' ? 0 : 1) || a.rank - b.rank || b.population - a.population || a.id.localeCompare(b.id, 'en'));
  const lakes = features('ne_10m_lakes').map(item => feature(item, 'lake', 0.002, item.properties.min_zoom));
  const world = { schemaVersion: 1,
    countries: collection(features('ne_50m_admin_0_countries').map(item => feature(item, 'country', 0.01))),
    water: collection(lakes.filter(item => item.properties.minZoom <= 2)), labels };
  const roads = features('ne_10m_roads').filter(item => ['Major Highway', 'Secondary Highway', 'Road', 'Beltway', 'Bypass'].includes(item.properties.type));
  const detail = { schemaVersion: 1,
    countries: collection(countrySource.map(item => feature(item, 'country', 0.0015))),
    water: collection(lakes),
    lines: collection([]) };
  const terrain = { schemaVersion: 1, countries: collection([]), water: collection([]),
    lines: collection([
      ...features('ne_10m_rivers_lake_centerlines').filter(item => item.properties.featurecla === 'River').map(item => feature(item, 'river', 0.003, Math.max(4, item.properties.min_zoom || 4))),
      ...features('ne_10m_admin_1_states_provinces_lines').map(item => feature(item, 'region', 0.003, Math.max(5, item.properties.MIN_ZOOM || 5)))
    ]) };
  const roadData = { schemaVersion: 1, countries: collection([]), water: collection([]),
    lines: collection(roads.map(item => feature(item, 'road', 0.003, Math.max(5, item.properties.min_zoom || 6)))) };
  return { world: validateMapData(world, 'world'), detail: validateMapData(detail, 'detail'),
    terrain: validateMapData(terrain, 'detail'), roads: validateMapData(roadData, 'detail'),
    omittedGeometry: Object.fromEntries(Object.entries(source).map(([name, data]) => [name, data.features.length - data.features.filter(hasGeometry).length])) };
}

export async function buildMapData({ sourceDirectory = path.join(root, '.build/map-source'), download = false } = {}) {
  const provenance = JSON.parse(await readFile(path.join(root, 'docs/provenance/map-data.json'), 'utf8'));
  const source = {};
  await mkdir(sourceDirectory, { recursive: true });
  for (const input of provenance.sources) {
    const file = path.join(sourceDirectory, `${input.name}.geojson`);
    if (download) {
      const response = await fetch(input.url, { signal: AbortSignal.timeout(90000) });
      if (!response.ok || Number(response.headers.get('content-length')) > 64 * 1024 * 1024) throw new Error('Map source unavailable');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 64 * 1024 * 1024 || digest(bytes) !== input.sha256) throw new Error(`Map source hash mismatch: ${input.name}`);
      await writeFile(file, bytes);
    }
    const bytes = await readFile(file);
    if (bytes.length !== input.bytes || digest(bytes) !== input.sha256) throw new Error(`Map source integrity failed: ${input.name}`);
    source[input.name] = JSON.parse(bytes);
  }
  const curated = curateMapData(source), outputs = [];
  for (const kind of ['world', 'detail', 'terrain', 'roads']) {
    const text = `// Natural Earth v5.1.2. Public domain. Generated by scripts/build-map-data.mjs.\nexport const MAP_${kind.toUpperCase()} = ${JSON.stringify(curated[kind])};\n`;
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('Curated map asset exceeds deployment cap');
    const relative = `site/assets/map-${kind}-${digest(text).slice(0,8)}.js`;
    await writeFile(path.join(root, relative), text);
    outputs.push({ path: relative, bytes: Buffer.byteLength(text), sha256: digest(text),
      countries: curated[kind].countries.features.length, lakes: curated[kind].water.features.length, omittedGeometry: curated.omittedGeometry,
      ...(kind === 'world' ? { labels: curated.world.labels.length } : { lines: curated[kind].lines.features.length }) });
  }
  return outputs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await buildMapData({ download: process.argv.includes('--download') }), null, 2)}\n`);
}
