import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { identifyMapCountries } from '../scripts/build-map-country-identifiers.mjs';
import { MAP_COUNTRY_IDENTIFIERS } from '../site/assets/map-country-identifiers.js';
import { passportMapCountries, setPassportMapCountries, subscribePassportMap } from '../site/assets/passport-map.js';
import { curateGeometry } from '../scripts/build-map-data.mjs';
import { identifyAtlasCountries } from '../site/assets/vector-atlas.js';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
test('polygon identification uses pinned source country codes and exact curated geometry, never a postal alias or centroid', () => {
  const raw = [
    { geometry, properties: { ISO_A2: '-99', ISO_A2_EH: 'FR', POSTAL: 'F' } },
    { geometry, properties: { ISO_A2: 'KR', ISO_A2_EH: '-99', POSTAL: 'KR' } },
    { geometry, properties: { ISO_A2: '-99', ISO_A2_EH: '-99', POSTAL: 'SL' } }
  ];
  const curated = raw.map(() => ({ geometry: curateGeometry(geometry, 0.01) }));
  assert.deepEqual(identifyMapCountries(raw, curated, 0.01), ['FR', 'KR', '']);
  const signedZero = structuredClone(raw); signedZero[0].geometry.coordinates[0][0][1] = -0;
  assert.deepEqual(identifyMapCountries(signedZero, JSON.parse(JSON.stringify(curated)), 0.01), ['FR', 'KR', '']);
  assert.throws(() => identifyMapCountries(raw, curated.slice(1), 0.01), /count/);
  const altered = structuredClone(curated); altered[1].geometry.coordinates[0][1][0] = 0.5;
  assert.throws(() => identifyMapCountries(raw, altered, 0.01), /geometry/);
});
test('both compact country indexes are pinned to the unchanged deployed assets and source geometry', async () => {
  const metadata = JSON.parse(await readFile(new URL('../docs/provenance/map-country-identifiers.json', import.meta.url)));
  const existing = JSON.parse(await readFile(new URL('../docs/provenance/map-data.json', import.meta.url)));
  const module = await readFile(new URL('../' + metadata.output.path, import.meta.url));
  assert.equal(module.length, metadata.output.bytes); assert.equal(createHash('sha256').update(module).digest('hex'), metadata.output.sha256);
  for (const kind of ['world', 'detail']) {
    const entry = metadata.assets[kind], codes = MAP_COUNTRY_IDENTIFIERS[kind].codes;
    const row = existing.outputs.find(row => row.path.endsWith('/' + entry.asset));
    assert.ok(row); assert.equal(entry.sha256, row.sha256); assert.equal(MAP_COUNTRY_IDENTIFIERS[kind].asset, entry.asset);
    assert.equal(codes.length, row.countries); assert.equal(entry.features, codes.length);
    assert.ok(codes.filter(Boolean).length >= 230); assert.ok(['DE', 'KR', 'FR', 'US', 'GB'].every(code => codes.includes(code)));
    assert.ok(codes.every(code => code === '' || /^[A-Z]{2}$/.test(code)));
    assert.equal(createHash('sha256').update(JSON.stringify(codes)).digest('hex'), entry.codesSha256);
    assert.match(entry.geometrySha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(metadata.sources.length, 2);
  assert.ok(metadata.sources.every(row => existing.sources.some(old => old.name === row.name && old.sha256 === row.sha256 && old.bytes === row.bytes)));
});
test('runtime country annotation is non-mutating and refuses a changed asset or feature count', () => {
  const index = MAP_COUNTRY_IDENTIFIERS.world;
  const data = { countries: { features: index.codes.map(() => ({ properties: { kind: 'country' }, geometry })) } };
  const annotated = identifyAtlasCountries(data, 'world', index.asset);
  assert.deepEqual(annotated.countries.features.map(row => row.properties.countrycode), index.codes);
  assert.equal(data.countries.features[0].properties.countrycode, undefined);
  assert.equal(annotated.countries.features[0].geometry, data.countries.features[0].geometry);
  assert.equal(identifyAtlasCountries(data, 'world', 'map-world-future.js'), data);
  const different = { countries: { features: [] } }; assert.equal(identifyAtlasCountries(different, 'world', index.asset), different);
});
test('map visit state is cloned, bounded and synchronously cleared without loading geography or retaining an owner', () => {
  setPassportMapCountries([]); const calls = [], unsubscribe = subscribePassportMap(value => calls.push(value));
  setPassportMapCountries(['KR', 'US', 'KR', '__proto__']);
  const clone = passportMapCountries(); clone.push('FR');
  assert.deepEqual(passportMapCountries(), ['KR', 'US']); assert.deepEqual(calls, [['KR', 'US']]);
  setPassportMapCountries([]); assert.deepEqual(calls.at(-1), []); assert.deepEqual(passportMapCountries(), []);
  unsubscribe(); setPassportMapCountries(['DE']); assert.equal(calls.length, 2); setPassportMapCountries([]);
});
