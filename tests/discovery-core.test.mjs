import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinates, distanceKm, inBounds, pickStation, rankSimilar, rankStations, sanitizePreferences } from '../site/assets/discovery-core.js';
import { createMapDirectory, mergeMappedStations } from '../site/assets/map-directory.js';
import { installDirectoryFetchPatch } from '../site/assets/pinned-stations.js';

const NOW = Date.UTC(2026, 10, 3);
function station(id, patch = {}) {
  return { stationuuid: id, name: id, country: 'France', countrycode: 'FR', language: 'French', tagList: ['jazz'],
    codec: 'MP3', bitrate: 128, quality: { score: 80 }, lastcheckok: true,
    url_resolved: `https://streams.example/${id}`, geo_lat: 48, geo_long: 2, ...patch };
}
const ids = entries => entries.map(entry => entry.station.stationuuid);

test('mapped directory bounds remain valid when the installed pinned-station fetch overlay is active', async () => {
  const patchedFetch = installDirectoryFetchPatch(async () => Response.json([station('mapped')]));
  const directory = createMapDirectory({ limit: 1, fetchImpl: patchedFetch });
  const result = await directory.load();
  assert.deepEqual(result.stations.map(s => s.stationuuid), ['mapped']);
  assert.equal(result.limited, true);
});

test('map directory requests mapped stations only and reuses one in-flight/cached result', async () => {
  let calls = 0;
  const directory = createMapDirectory({ fetchImpl: async (rawUrl, options) => {
    calls++;
    const url = new URL(rawUrl);
    assert.equal(url.searchParams.get('has_geo_info'), 'true');
    assert.equal(url.searchParams.get('hidebroken'), 'true');
    assert.equal(url.searchParams.get('limit'), '10000');
    assert.equal(options.credentials, 'omit');
    return Response.json([station('valid'), station('valid'), station('missing', { geo_lat: null }),
      station('malformed-geo', { geo_lat: { toString: null } }), station('unsafe', { url_resolved: 'file:///secret' })]);
  } });
  const first = directory.load();
  assert.equal(directory.load(), first);
  const result = await first;
  assert.deepEqual(result.stations.map(s => s.stationuuid), ['valid']);
  assert.equal(await directory.load(), result);
  assert.equal(calls, 1);
});

test('map directory falls back to the second fixed HTTPS mirror', async () => {
  const calls = [];
  const directory = createMapDirectory({ fetchImpl: async url => {
    calls.push(new URL(url).origin);
    return calls.length === 1 ? new Response('', { status: 503 }) : Response.json([station('recovered')]);
  } });
  assert.equal((await directory.load()).stations[0].stationuuid, 'recovered');
  assert.deepEqual(calls, ['https://de1.api.radio-browser.info', 'https://all.api.radio-browser.info']);
});

for (const [name, options, payload] of [
  ['byte cap', { maxBytes: 16 }, [station('too-large')]],
  ['record cap', { limit: 1 }, [station('a'), station('b')]],
  ['invalid shape', {}, { stations: [] }]
]) {
  test(`map directory enforces its ${name} and leaves failure retryable`, async () => {
    let bad = true;
    const directory = createMapDirectory({ ...options, fetchImpl: async () => Response.json(bad ? payload : []) });
    await assert.rejects(directory.load(), /unavailable/);
    bad = false;
    assert.deepEqual((await directory.load()).stations, []);
  });
}

test('map directory bounds a stalled request by one deadline', async () => {
  let calls = 0;
  const directory = createMapDirectory({ timeoutMs: 15, fetchImpl: (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  await assert.rejects(directory.load(), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('cancelled map searches cannot cache stale data or clear a newer request', async () => {
  let release, calls = 0;
  const directory = createMapDirectory({ fetchImpl: async () => ++calls === 1
    ? new Promise(resolve => { release = resolve; }) : Response.json([station('new')]) });
  const old = directory.load();
  directory.cancel();
  const next = directory.load();
  release(Response.json([station('old')]));
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal((await next).stations[0].stationuuid, 'new');
  assert.equal((await directory.load()).stations[0].stationuuid, 'new');
});

test('map sample limits are explicit and enriched merges retain existing source quality', async () => {
  const directory = createMapDirectory({ limit: 1, fetchImpl: async () => Response.json([station('a')]) });
  assert.equal((await directory.load()).limited, true);
  const base = station('a', { geo_lat: null, geo_long: null, quality: { score: 99 } });
  const result = mergeMappedStations([base], [station('a'), station('b')]);
  assert.equal(result.length, 2);
  assert.equal(result[0].quality.score, 99);
  assert.deepEqual(coordinates(result[0]), [48, 2]);
  assert.equal(base.geo_lat, null);
  assert.throws(() => createMapDirectory({ limit: Infinity }), /limits/);
});

test('exact title beats a country/tag match and search terms are conjunctive', () => {
  const a = station('a', { name: 'Jazz Paris' });
  const b = station('b', { name: 'Paris News', tagList: ['news'] });
  const c = station('c', { name: 'Jazz Everywhere', country: 'Paris' });
  assert.deepEqual(ids(rankStations([c, b, a], { query: 'jazz paris', now: NOW })), ['a', 'c']);
  assert.deepEqual(ids(rankStations([a, b], { query: 'unfindable', now: NOW })), []);
});

test('Unicode, accents, bounded typos, and non-Latin scripts remain searchable', () => {
  const pool = [station('a', { name: 'Café Montréal' }), station('b', { name: '서울 라디오' }), station('c', { name: 'Electronic FM' })];
  assert.deepEqual(ids(rankStations(pool, { query: 'cafe montreal' })), ['a']);
  assert.deepEqual(ids(rankStations(pool, { query: '서울' })), ['b']);
  assert.deepEqual(ids(rankStations(pool, { query: 'eletronic' })), ['c']);
  assert.deepEqual(ids(rankStations(pool, { query: 'zz' })), []);
});

test('hard filters do not admit HTTP, missing metadata, or text that only resembles a secure URL', () => {
  const pool = [station('yes'), station('http', { url_resolved: 'http://streams.example/a' }),
    station('fake', { url_resolved: 'https://user:pass@streams.example/a' }),
    station('missing', { bitrate: null, language: '' }), station('slow', { bitrate: 64 })];
  assert.deepEqual(ids(rankStations(pool, { secureOnly: true, minBitrate: 128, language: 'french' })), ['yes']);
  assert.deepEqual(ids(rankStations(pool, { genre: 'jaz' })), []);
});

test('ranking is finite, input-order independent, immutable, and stable for ties', () => {
  const pool = [station('b', { bitrate: Infinity, quality: { score: NaN } }), station('c'), station('a')];
  const before = structuredClone(pool);
  const result = rankStations(pool, { now: NOW });
  assert.deepEqual(ids(result), ids(rankStations([...pool].reverse(), { now: NOW })));
  assert.ok(result.every(entry => Number.isFinite(entry.score) && entry.reasons.length > 0));
  assert.deepEqual(pool, before);
});

test('recent playback failures suppress recommendations and expire instead of poisoning stations forever', () => {
  const pool = [station('a'), station('b')];
  const badStations = new Map([['a', { failures: 2, lastFailureAt: new Date(NOW - 1000).toISOString() }]]);
  assert.equal(rankStations(pool, { badStations, now: NOW })[0].station.stationuuid, 'b');
  assert.deepEqual(ids(rankStations(pool, { badStations, avoidFailures: true, now: NOW })), ['b']);
  assert.equal(rankStations(pool, { badStations, avoidFailures: true, now: NOW + 7 * 86400000 }).length, 2);
  assert.equal(pickStation([pool[0]], { badStations, now: NOW }, () => 0), null);
});

test('similarity uses normalized tag overlap, excludes self and duplicate stream endpoints', () => {
  const target = station('target', { tagList: ['Jazz', 'soul'] });
  const match = station('match', { tagList: ['jazz', 'soul'] });
  const unrelated = station('noise', { tagList: ['metal'], countrycode: 'US', language: 'English' });
  const clone = station('clone', { url_resolved: target.url_resolved });
  assert.deepEqual(rankSimilar(target, [unrelated, clone, target, match], 2).map(s => s.stationuuid), ['match']);
});

test('exploration diversifies country/genre instead of returning near-identical high-score stations', () => {
  const pool = [station('a'), station('b'), station('c', { countrycode: 'JP', tagList: ['ambient'], quality: { score: 78 } })];
  const result = rankStations(pool, { sort: 'explore', now: NOW });
  assert.equal(result[1].station.stationuuid, 'c');
});

test('random selection is injectable, endpoint-deduplicated, and excludes the current station', () => {
  const a = station('a'), b = station('b'), duplicate = station('copy', { url_resolved: b.url_resolved });
  assert.equal(pickStation([a, b, duplicate], { current: a, now: NOW }, () => 0).stationuuid, 'b');
  assert.equal(pickStation([], {}, () => 0), null);
  assert.equal(pickStation([a], {}, () => NaN), a);
});

test('coordinates reject absent/invalid/Null Island data, while real zero-axis positions work', () => {
  for (const value of [null, '', false, undefined, 'NaN', Infinity, 91]) assert.equal(coordinates(station('a', { geo_lat: value })), null);
  assert.equal(coordinates(station('a', { geo_lat: 0, geo_long: 0 })), null);
  assert.deepEqual(coordinates(station('a', { geo_lat: '0', geo_long: '12' })), [0, 12]);
  assert.ok(Math.abs(distanceKm([0, 0], [0, 1]) - 111.195) < 0.01);
});

test('bounds handle the antimeridian, repeated worlds, and invalid rectangles', () => {
  const bounds = { south: -20, north: 20, west: 170, east: -170 };
  assert.equal(inBounds(station('a', { geo_lat: 1, geo_long: 179 }), bounds), true);
  assert.equal(inBounds(station('a', { geo_lat: 1, geo_long: -179 }), bounds), true);
  assert.equal(inBounds(station('a', { geo_lat: 1, geo_long: 0 }), bounds), false);
  assert.equal(inBounds(station('a'), { south: 90, north: -90, west: -180, east: 180 }), false);
  assert.equal(inBounds(station('a'), { south: -85, north: 85, west: -540, east: 540 }), true);
});

test('preference validation bounds input and rejects arbitrary sort/state data', () => {
  assert.deepEqual(sanitizePreferences({ sort: 'eval', query: 'x'.repeat(1000), minBitrate: -1, secureOnly: 'yes', avoidFailures: true }),
    { query: 'x'.repeat(160), sort: 'best', genre: '', language: '', minBitrate: 0, secureOnly: false, avoidFailures: true });
  assert.equal(sanitizePreferences(null).sort, 'best');
});

test('malformed records and unsafe stream protocols are excluded from playable recommendations', () => {
  const pool = [null, {}, station('a', { url_resolved: 'javascript:alert(1)' }), station('b')];
  assert.deepEqual(ids(rankStations(pool)), ['b']);
  assert.equal(pickStation(pool, {}, () => 0).stationuuid, 'b');
});
