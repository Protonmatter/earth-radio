import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LISTEN_MOE_STATIONS,
  isDirectoryRequest,
  mergePinnedStations,
  installDirectoryFetchPatch
} from '../site/assets/pinned-stations.js';

test('LISTEN.moe is catalogued as two HTTPS MP3 fallbacks the metadata overlay can detect', () => {
  assert.equal(LISTEN_MOE_STATIONS.length, 2);
  const [jpop, kpop] = LISTEN_MOE_STATIONS;
  assert.equal(jpop.name, 'LISTEN.moe');
  assert.equal(jpop.url_resolved, 'https://listen.moe/fallback');
  assert.equal(jpop.countrycode, 'JP');
  assert.equal(kpop.name, 'LISTEN.moe Kpop');
  assert.equal(kpop.url_resolved, 'https://listen.moe/kpop/fallback');
  assert.equal(kpop.countrycode, 'KR');
  for (const station of LISTEN_MOE_STATIONS) {
    assert.match(station.url_resolved, /^https:\/\/listen\.moe\//);
    assert.equal(station.codec, 'MP3');
    assert.equal(station.lastcheckok, 1);
    assert.ok(station.stationuuid.startsWith('earth-radio:listen.moe:'));
  }
});

test('directory request matching covers Radio Browser and the desktop federated endpoint', () => {
  assert.equal(isDirectoryRequest('https://de1.api.radio-browser.info/json/stations/topclick/3000?hidebroken=true'), true);
  assert.equal(isDirectoryRequest('https://all.api.radio-browser.info/json/stations/search?countrycode=KR'), true);
  assert.equal(isDirectoryRequest('http://127.0.0.1:9/api/stations/federated?limit=3000'), true);
  assert.equal(isDirectoryRequest('http://127.0.0.1:9/api/stations/top?limit=3000'), true);
  assert.equal(isDirectoryRequest('https://de1.api.radio-browser.info/json/countries'), false);
  assert.equal(isDirectoryRequest('https://de1.api.radio-browser.info/json/url/abc'), false);
  assert.equal(isDirectoryRequest('https://earth-radio.pages.dev/api/nowplaying?url=https://listen.moe/fallback'), false);
});

test('merge appends missing Listen.moe records and is a no-op when they are already present', () => {
  const directory = [{ stationuuid: 'other', name: 'Other', url_resolved: 'https://example.org/x' }];
  const merged = mergePinnedStations(directory);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].stationuuid, 'other');
  assert.deepEqual(merged.slice(1).map(station => station.stationuuid), [
    'earth-radio:listen.moe:jpop',
    'earth-radio:listen.moe:kpop'
  ]);
  assert.equal(directory.length, 1);

  const again = mergePinnedStations(merged);
  assert.equal(again, merged);

  const wrapped = mergePinnedStations({ source: 'cache', stations: directory });
  assert.equal(wrapped.source, 'cache');
  assert.equal(wrapped.stations.length, 3);
});

test('the fetch patch injects Listen.moe into directory JSON and leaves other traffic alone', async () => {
  const calls = [];
  const inner = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/json/countries')) {
      return new Response(JSON.stringify([{ name: 'Japan', iso_3166_1: 'JP' }]), {
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify([{ stationuuid: 'rb-1', name: 'RB', url_resolved: 'https://example.org/rb' }]), {
      headers: { 'content-type': 'application/json' }
    });
  };
  const patched = installDirectoryFetchPatch(inner);
  const directory = await (await patched('https://nl1.api.radio-browser.info/json/stations/topclick/10')).json();
  assert.equal(directory.length, 3);
  assert.ok(directory.some(station => station.stationuuid === 'earth-radio:listen.moe:jpop'));

  const countries = await (await patched('https://nl1.api.radio-browser.info/json/countries')).json();
  assert.deepEqual(countries, [{ name: 'Japan', iso_3166_1: 'JP' }]);
  assert.equal(installDirectoryFetchPatch(patched), patched);
  assert.deepEqual(calls, [
    'https://nl1.api.radio-browser.info/json/stations/topclick/10',
    'https://nl1.api.radio-browser.info/json/countries'
  ]);
});
