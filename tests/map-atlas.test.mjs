import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { layoutMapLabels, sanitizeMapLabels, intersectsBounds, validateMapData, resolveMapTheme } from '../site/assets/map-core.js';
import { simplifyLine } from '../scripts/build-map-data.mjs';
import { settledMapAction } from '../site/assets/discovery-ui.js';
import { mapDataTextForScan } from '../scripts/validate-site.mjs';

const root = path.resolve(import.meta.dirname, '..');
const label = (id, kind, x, y, minZoom = 2) => ({ id, kind, name: id, names: {}, point: [x, y], minZoom, rank: 1, population: 1 });
const options = { zoom: 4, width: 600, height: 400, project: ([x, y]) => ({ x, y }) };

test('explicit map actions cannot restart bounds correction and always restore drag limits', () => {
  const bounds = [[-85, -180], [85, 180]];
  let correctionRestarted = false, measured = false;
  const map = { options: { maxBounds: bounds },
    setMaxBounds(value) { this.options.maxBounds = value; },
    stop() { correctionRestarted ||= Boolean(this.options.maxBounds); },
    invalidateSize(options) { assert.equal(options.pan, false); measured = true; }
  };
  assert.equal(settledMapAction(map, () => 'fitted'), 'fitted');
  assert.equal(correctionRestarted, false); assert.equal(measured, true);
  assert.equal(map.options.maxBounds, bounds);
  assert.throws(() => settledMapAction(map, () => { throw Error('fit failed'); }), /fit failed/);
  assert.equal(map.options.maxBounds, bounds);
});

test('map label preferences default on and accept only explicit false', () => {
  assert.deepEqual(sanitizeMapLabels(null), { countries: true, cities: true });
  assert.deepEqual(sanitizeMapLabels({ countries: false, cities: true, secret: 'ignored' }), { countries: false, cities: true });
  assert.deepEqual(sanitizeMapLabels({ cities: 'false' }), { countries: true, cities: true });
});

test('the owned palette wins over a transient runtime theme during a toggle', () => {
  assert.equal(resolveMapTheme('night', 'light'), 'dark');
  assert.equal(resolveMapTheme('paper', 'dark'), 'light');
  assert.equal(resolveMapTheme(undefined, 'light'), 'light');
});

test('decluttering is deterministic, respects zoom and keeps countries/cities independent', () => {
  const labels = [label('Country', 'country', 200, 100), label('City', 'city', 200, 100), label('Other city', 'city', 400, 300, 6)];
  assert.deepEqual(layoutMapLabels(labels, options).map(x => x.name), ['Country']);
  assert.deepEqual(layoutMapLabels(labels, { ...options, countries: false }).map(x => x.name), ['City']);
  assert.deepEqual(layoutMapLabels(labels, { ...options, zoom: 7, cities: false }).map(x => x.name), ['Country']);
  assert.deepEqual(layoutMapLabels(labels, { ...options, zoom: 7 }).map(x => x.name), ['Country', 'Other city']);
  assert.deepEqual(layoutMapLabels(labels, options), layoutMapLabels(labels, options));
});

test('labels clip safely at viewport edges and use localized names as text', () => {
  const labels = [label('outside', 'city', -100, 50), label('edge', 'country', 0, 40),
    { ...label('Korea', 'country', 300, 150), names: { ko: '대한민국' } }];
  assert.deepEqual(layoutMapLabels(labels, { ...options, locale: 'ko' }).map(x => x.name), ['대한민국']);
  assert.equal(intersectsBounds([-10, -10, 10, 10], [10, 10, 20, 20]), true);
  assert.equal(intersectsBounds([-10, -10, 10, 10], [11, 11, 20, 20]), false);
});

test('RTL city labels extend left while their dot stays anchored to the geographic point', () => {
  const city = label('London', 'city', 300, 150);
  const ltr = layoutMapLabels([city], options)[0], rtl = layoutMapLabels([city], { ...options, locale: 'ar' })[0];
  assert.equal(ltr.anchorX, 2);
  assert.equal(rtl.anchorX, rtl.width - 2);
});

test('source simplification preserves endpoints, valid closed rings and determinism', () => {
  const line = [[0, 0], [1, 0.0001], [2, 0]];
  assert.deepEqual(simplifyLine(line, 0.01), [[0, 0], [2, 0]]);
  const ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const result = simplifyLine(ring, 0.01, true);
  assert.ok(result.length >= 4); assert.deepEqual(result[0], result.at(-1));
  assert.deepEqual(result, simplifyLine(ring, 0.01, true));
  assert.throws(() => simplifyLine([[0, 0], [NaN, 1]], 0.1), /Invalid source/);
});

for (const kind of ['world', 'detail', 'terrain', 'roads']) {
  test(`generated ${kind} map is data-only, bounded and contains real geography`, async () => {
    const source = await readFile(path.join(root, `site/assets/map-${kind}.js`), 'utf8');
    assert.ok(Buffer.byteLength(source) < 16 * 1024 * 1024);
    const provenance = JSON.parse(await readFile(path.join(root, 'docs/provenance/map-data.json'), 'utf8'));
    const recorded = provenance.outputs.find(row => row.path === `site/assets/map-${kind}.js`);
    assert.equal(recorded.bytes, Buffer.byteLength(source));
    assert.equal(recorded.sha256, createHash('sha256').update(source).digest('hex'));
    const scanned = mapDataTextForScan(source, kind);
    assert.ok(scanned.length < source.length);
    const data = JSON.parse(source.slice(source.indexOf(' = ') + 3).trim().replace(/;$/, ''));
    validateMapData(data, kind === 'world' ? 'world' : 'detail');
    if (kind === 'world') {
      assert.ok(data.countries.features.length >= 240);
      assert.ok(data.labels.filter(x => x.kind === 'city').length >= 7000);
      assert.ok(data.labels.some(x => x.kind === 'city' && x.name === 'Seoul'));
      assert.ok(data.labels.some(x => x.kind === 'country' && x.name === 'South Korea'));
    }
    assert.throws(() => mapDataTextForScan(source + '\nglobalThis.unexpected=true;', kind), /JSON|data-only|Unexpected/);
  });
}

test('map data rejects executable envelopes, extra properties and invalid geometry bounds', () => {
  const feature = { type: 'Feature', properties: { kind: 'country', minZoom: 0, bounds: [0, 0, 1, 1] },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
  const data = { schemaVersion: 1, countries: { type: 'FeatureCollection', features: [feature] }, water: { type: 'FeatureCollection', features: [] }, labels: [] };
  validateMapData(data, 'world');
  assert.throws(() => validateMapData({ ...data, script: 'hidden' }, 'world'), /envelope/);
  const bad = structuredClone(data); bad.countries.features[0].geometry.coordinates[0][1] = [127.3, 0];
  assert.throws(() => validateMapData(bad, 'world'), /bounds/);
  const open = structuredClone(data); open.countries.features[0].geometry.coordinates[0][3] = [0, 1];
  assert.throws(() => validateMapData(open, 'world'), /ring/);
});
