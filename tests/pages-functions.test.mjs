// Unit tests for the Cloudflare Pages Functions. They use only Web APIs
// (Request/Response/fetch/streams), all of which exist in Node, so the handlers are
// exercised directly with a stubbed global fetch.

import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet as nowPlayingGet, rejectStreamUrl } from '../functions/api/nowplaying.js';
import { onRequestGet as fingerprintGet } from '../functions/api/track/fingerprint.js';
import { extractIcyTitle, icyReadBudget, parseIcyTitle } from '../server/icy-title.mjs';

const realFetch = globalThis.fetch;

function withFetch(impl, run) {
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(run)
    .finally(() => { globalThis.fetch = realFetch; });
}

function icyStreamBody(metaint, title) {
  const metadata = `StreamTitle='${title}';`;
  const padded = metadata + '\0'.repeat(16 - (metadata.length % 16 || 16));
  const bytes = new Uint8Array(metaint + 1 + padded.length + 64);
  bytes[metaint] = padded.length / 16;
  new TextEncoder().encodeInto(padded, bytes.subarray(metaint + 1));
  return bytes;
}

test('ICY title extraction parses interleaved metadata blocks', () => {
  const bytes = icyStreamBody(64, 'Kate Bush - Running Up That Hill');
  assert.equal(extractIcyTitle(bytes, 64), 'Kate Bush - Running Up That Hill');
  assert.equal(extractIcyTitle(bytes, 0), '');
  assert.equal(parseIcyTitle("StreamTitle='IU - Blueming';StreamUrl='';"), 'IU - Blueming');
  assert.ok(icyReadBudget(16000, 2) > 16000);
  assert.equal(icyReadBudget(0), 0);
});

test('nowplaying probe answers without touching the network', async () => {
  await withFetch(() => { throw new Error('network must not be used'); }, async () => {
    const response = await nowPlayingGet({ request: new Request('https://site.example/api/nowplaying') });
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'earth-radio-pages-fn');
  });
});

test('nowplaying rejects private stream hosts', async () => {
  assert.equal(rejectStreamUrl('http://192.168.1.10/stream'), 'private stream hosts are blocked');
  assert.equal(rejectStreamUrl('http://[::1]/stream'), 'private stream hosts are blocked');
  assert.equal(rejectStreamUrl('ftp://example.org/x'), 'only http/https stream URLs are allowed');
  assert.equal(rejectStreamUrl('https://ice.example.net/mount'), '');
  const response = await nowPlayingGet({ request: new Request('https://site.example/api/nowplaying?url=http%3A%2F%2Flocalhost%2Fs') });
  assert.equal(response.status, 400);
});

test('nowplaying resolves a platform payload before falling back to ICY', async () => {
  await withFetch(async target => {
    const url = String(target);
    if (url.includes('/api/nowplaying/my_station')) {
      return Response.json({ now_playing: { song: { artist: 'IU', title: 'Blueming', text: 'IU - Blueming' } } });
    }
    return new Response('nope', { status: 404 });
  }, async () => {
    const request = new Request(`https://site.example/api/nowplaying?url=${encodeURIComponent('https://radio.example.org/listen/my_station/radio.mp3')}`);
    const body = await (await nowPlayingGet({ request })).json();
    assert.equal(body.found, true);
    assert.equal(body.artist, 'IU');
    assert.equal(body.title, 'Blueming');
  });
});

test('nowplaying falls back to a one-shot ICY read', async () => {
  const metaint = 64;
  await withFetch(async (target, init) => {
    const url = String(target);
    if (url === 'https://ice.example.net/mount') {
      assert.equal(init.headers['Icy-MetaData'], '1');
      return new Response(icyStreamBody(metaint, 'NewJeans - Super Shy'), { headers: { 'icy-metaint': String(metaint) } });
    }
    return new Response('nope', { status: 404 });
  }, async () => {
    const request = new Request(`https://site.example/api/nowplaying?url=${encodeURIComponent('https://ice.example.net/mount')}`);
    const body = await (await nowPlayingGet({ request })).json();
    assert.equal(body.found, true);
    assert.equal(body.source, 'icy');
    assert.equal(body.artist, 'NewJeans');
    assert.equal(body.title, 'Super Shy');
  });
});

test('nowplaying reports station-name ICY text instead of promoting it', async () => {
  const metaint = 32;
  await withFetch(async target => {
    if (String(target) === 'https://ice.example.net/talk') {
      return new Response(icyStreamBody(metaint, 'News'), { headers: { 'icy-metaint': String(metaint) } });
    }
    return new Response('nope', { status: 404 });
  }, async () => {
    const request = new Request(`https://site.example/api/nowplaying?url=${encodeURIComponent('https://ice.example.net/talk')}`);
    const body = await (await nowPlayingGet({ request })).json();
    assert.equal(body.found, false);
    assert.match(body.reason, /junk|station/i);
  });
});

test('fingerprint availability reflects configured credentials only', async () => {
  await withFetch(() => { throw new Error('network must not be used'); }, async () => {
    const probe = new Request('https://site.example/api/track/fingerprint');
    const none = await (await fingerprintGet({ request: probe, env: {} })).json();
    assert.equal(none.available, false);

    const audd = await (await fingerprintGet({ request: probe, env: { AUDD_API_TOKEN: 't' } })).json();
    assert.equal(audd.available, true);
    assert.deepEqual(audd.providers, ['audd']);

    const withUrl = new Request('https://site.example/api/track/fingerprint?url=https%3A%2F%2Fice.example.net%2Fmount');
    const unavailable = await (await fingerprintGet({ request: withUrl, env: {} })).json();
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.found, false);
  });
});

test('fingerprint refuses short samples without spending recognition quota', async () => {
  await withFetch(async target => {
    if (String(target) === 'https://ice.example.net/short') {
      return new Response(new Uint8Array(1024), { headers: { 'content-type': 'audio/mpeg' } });
    }
    throw new Error(`unexpected fetch ${target}`);
  }, async () => {
    const request = new Request('https://site.example/api/track/fingerprint?url=https%3A%2F%2Fice.example.net%2Fshort');
    const body = await (await fingerprintGet({ request, env: { AUDD_API_TOKEN: 't' } })).json();
    assert.equal(body.found, false);
    assert.match(body.reason, /too short/);
  });
});
