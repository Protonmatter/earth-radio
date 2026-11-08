import { readFile, readdir } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMapData } from '../site/assets/map-core.js';

async function collectFiles(root) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll(path.sep, '/'));
    }
  }
  await walk(root);
  return files.sort();
}

function localAsset(value) {
  if (!value || /^(?:https?:|data:|blob:|#|mailto:)/i.test(value)) return null;
  return value.replace(/^\.\//, '').split(/[?#]/, 1)[0].replace(/\/$/, 'index.html');
}

function parseHeaderRules(source) {
  const rules = [];
  let current = null;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: trimmed, headers: [] };
      rules.push(current);
      continue;
    }
    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (current && match) {
      current.headers.push({ name: match[1].trim().toLowerCase(), value: match[2].trim() });
    }
  }
  return rules;
}

function headerPatternMatches(pattern, relative) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(`/${relative}`);
}

function isCloudflareControlFile(relative) {
  return relative === '_headers' || relative === '_redirects' || relative === '_routes.json';
}

function isFingerprintedAsset(relative) {
  return /-[A-Za-z0-9_-]{8}\.[^.]+$/.test(path.basename(relative));
}

// Numeric longitudes such as 127.283 resemble shorthand loopback addresses to
// the general text scanner. Parse this one data-only module without executing
// it; validate every allowed field/ring/point before removing only coordinates
// from the local-reference scan. Extra code, properties, URLs, and bad geometry
// cannot use the data path as an exception to the deployment boundary.
function atlasTextForScan(source) {
  const match = source.match(/^(\/\/[^\r\n]*\r?\n)export const WORLD_LAND = ([\s\S]*);\s*$/);
  if (!match) throw new Error('Expected a data-only atlas module');
  const world = JSON.parse(match[2]);
  const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === expected.slice().sort().join(',');
  if (!keys(world, ['type', 'features']) || world.type !== 'FeatureCollection' ||
    !Array.isArray(world.features) || !world.features.length || world.features.length > 500) throw new Error('Invalid collection');
  let points = 0;
  for (const feature of world.features) {
    if (!keys(feature, ['type', 'properties', 'geometry']) || feature.type !== 'Feature' || !keys(feature.properties, []) ||
      !keys(feature.geometry, ['type', 'coordinates'])) throw new Error('Invalid land feature');
    const geometry = feature.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
    if (!Array.isArray(polygons) || !polygons.length) throw new Error('Invalid polygon collection');
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length) throw new Error('Invalid polygon');
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) throw new Error('Invalid ring');
        for (const point of ring) {
          if (++points > 250000 || !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) ||
            Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('Invalid coordinate');
        }
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('Open polygon ring');
      }
    }
    geometry.coordinates = [];
  }
  return match[1] + JSON.stringify(world);
}

export function mapDataTextForScan(source, kind) {
  const match = source.match(/^(\/\/[^\r\n]*\r?\n)export const MAP_(WORLD|DETAIL|TERRAIN|ROADS) = ([\s\S]+);\s*$/);
  if (!match || match[2].toLowerCase() !== kind) throw new Error('Expected a data-only map module');
  const data = validateMapData(JSON.parse(match[3]), kind === 'world' ? 'world' : 'detail');
  for (const key of ['countries', 'water', 'lines']) {
    for (const feature of data[key]?.features ?? []) { feature.geometry.coordinates = []; feature.properties.bounds = []; }
  }
  for (const label of data.labels ?? []) label.point = [];
  return match[1] + JSON.stringify(data);
}

export async function validateSite(rootInput) {
  const root = path.resolve(rootInput);
  const files = await collectFiles(root);
  const fileSet = new Set(files);
  const errors = [];
  for (const required of ['index.html', 'config.js', 'sw.js', 'manifest.webmanifest', '_headers']) {
    if (!fileSet.has(required)) errors.push(`Missing required file: ${required}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));

  if(fileSet.has('_routes.json')){
    const routes=JSON.parse(await readFile(path.join(root,'_routes.json'),'utf8'));
    if(routes.version!==1||JSON.stringify(routes.include)!==JSON.stringify(['/api/*','/directory/*'])||!Array.isArray(routes.exclude)||routes.exclude.length)errors.push('Functions routes must cover only metadata APIs and the finite directory');
  }

  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const assets = [];
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    const asset = localAsset(match[1]);
    if (asset) assets.push(asset);
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons ?? []) {
    const asset = localAsset(icon.src);
    if (asset) assets.push(asset);
  }
  const serviceWorker = await readFile(path.join(root, 'sw.js'), 'utf8');
  for (const match of serviceWorker.matchAll(/["'](\.\/[^"']*)["']/g)) {
    const asset = localAsset(match[1]);
    if (asset && asset !== 'index.html') assets.push(asset);
  }
  for (const asset of [...new Set(assets)].sort()) {
    if (!fileSet.has(asset)) errors.push(`Missing asset referenced by site: ${asset}`);
  }

  const headerRules = parseHeaderRules(await readFile(path.join(root, '_headers'), 'utf8'));
  for (const relative of files.filter(file => !isCloudflareControlFile(file) && !isFingerprintedAsset(file))) {
    const cacheControl = headerRules
      .filter(rule => headerPatternMatches(rule.pattern, relative))
      .flatMap(rule => rule.headers)
      .filter(header => header.name === 'cache-control')
      .map(header => header.value)
      .join(', ');
    if (/\bimmutable\b/i.test(cacheControl)) {
      errors.push(`Non-fingerprinted asset ${relative} inherits immutable caching`);
    }
  }

  const config = await readFile(path.join(root, 'config.js'), 'utf8');
  if (!/proxyBaseUrl:\s*desktopProxyBaseUrl\s*\|\|\s*['"]{2}/.test(config)) {
    errors.push('config.js does not fail closed to browser-direct mode');
  }
  const textExtensions = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '']);
  const forbidden = /localhost|127\.\d{1,3}(?:\.\d{1,3}){0,2}\b|\[::1\]|0\.0\.0\.0|file:\/\/|[A-Za-z]:\\Users\\/i;
  for (const relative of files) {
    if (!textExtensions.has(path.extname(relative))) continue;
    const content = await readFile(path.join(root, ...relative.split('/')), 'utf8');
    let textForScan = content;
    if (relative === 'assets/world-land.js') {
      try { textForScan = atlasTextForScan(content); }
      catch (error) { errors.push(`Invalid atlas data in ${relative}: ${error.message}`); }
    }
    const mapData = relative.match(/^assets\/map-(world|detail|terrain|roads)(?:-[a-f0-9]{8})?\.js$/);
    if(!mapData&&/^assets\/map-(world|detail|terrain|roads)-.*\.js$/.test(relative))errors.push(`Invalid generated map filename: ${relative}`);
    if (mapData) {
      const hash=relative.match(/-([a-f0-9]{8})\.js$/)?.[1];
      if(hash&&createHash('sha256').update(content).digest('hex').slice(0,8)!==hash)errors.push(`Map filename hash mismatch: ${relative}`);
      try { textForScan = mapDataTextForScan(content, mapData[1]); }
      catch (error) { errors.push(`Invalid map data in ${relative}: ${error.message}`); }
    }
    if (forbidden.test(textForScan)) {
      errors.push(`Forbidden local reference in ${relative}`);
    }
    if (/[/#@]\s*sourceMappingURL\s*=/i.test(content)) {
      errors.push(`Source map reference is not deployable in ${relative}`);
    }
  }
  if (files.some(file => file.endsWith('.map'))) errors.push('Source maps are not deployable');
  if (errors.length) throw new Error(errors.sort().join('\n'));
  return { ok: true, files, assets: [...new Set(assets)].sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? 'site');
  const result = await validateSite(root);
  process.stdout.write(`Validated ${result.files.length} site files and ${result.assets.length} references.\n`);
}
