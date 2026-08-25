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
  assert.equal(rejectStreamUrl('http://192.168.1.10/stream'), 'private hosts are blocked');
  assert.equal(rejectStreamUrl('http://[::1]/stream'), 'private hosts are blocked');
  assert.equal(rejectStreamUrl('ftp://example.org/x'), 'only http/https URLs are allowed');
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

// --- Guarded fetch boundary (Pages) regressions ---

import { createRateLimiter, guardedFetch, readBodyCapped, rejectFetchUrl } from '../functions/_shared/guarded-fetch.js';
import { fingerprintCacheKey, normalizeCountry, onRequestGet as fingerprintGet2 } from '../functions/api/track/fingerprint.js';
import { resolveNowPlaying } from '../functions/api/nowplaying.js';

test('rejectFetchUrl covers encoded, mapped, and credentialed private forms', () => {
  assert.equal(rejectFetchUrl('http://2130706433/stream'), 'private hosts are blocked');
  assert.equal(rejectFetchUrl('http://0x7f000001/stream'), 'private hosts are blocked');
  assert.equal(rejectFetchUrl('http://[::ffff:127.0.0.1]/stream'), 'private hosts are blocked');
  assert.equal(rejectFetchUrl('http://169.254.169.254/latest/meta-data'), 'private hosts are blocked');
  assert.equal(rejectFetchUrl('https://user:pass@radio.example/stream'), 'credentials in URLs are not allowed');
  assert.equal(rejectFetchUrl('https://internal.corp.internal/x'), 'private hosts are blocked');
  assert.equal(rejectFetchUrl('https://ice.example.net/mount'), '');
});

test('guardedFetch revalidates every redirect hop and never fetches a private target', async () => {
  const fetched = [];
  const fetchImpl = async (url, init) => {
    fetched.push({ url: String(url), userAgent: init.headers['User-Agent'] || '' });
    if (String(url) === 'https://radio.example/stream') {
      return new Response(null, { status: 302, headers: { location: 'https://cdn.example/live.mp3' } });
    }
    return new Response('audio', { status: 200 });
  };
  const ok = await guardedFetch('https://radio.example/stream', { deadlineAt: Date.now() + 5000, fetchImpl });
  assert.equal(ok.finalUrl, 'https://cdn.example/live.mp3');
  assert.equal(ok.hops, 1);
  assert.ok(fetched.every(entry => entry.userAgent.startsWith('EarthRadio/')));

  const privateFetches = [];
  await assert.rejects(
    guardedFetch('https://radio.example/stream', {
      deadlineAt: Date.now() + 5000,
      fetchImpl: async url => {
        privateFetches.push(String(url));
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/internal' } });
      }
    }),
    /private hosts are blocked/
  );
  assert.deepEqual(privateFetches, ['https://radio.example/stream']);
});

test('guardedFetch resolves relative locations and bounds loops and hops', async () => {
  const relative = await guardedFetch('https://radio.example/a', {
    deadlineAt: Date.now() + 5000,
    fetchImpl: async url => String(url).endsWith('/a')
      ? new Response(null, { status: 301, headers: { location: '/b' } })
      : new Response('ok', { status: 200 })
  });
  assert.equal(relative.finalUrl, 'https://radio.example/b');

  await assert.rejects(
    guardedFetch('https://radio.example/a', {
      deadlineAt: Date.now() + 5000,
      fetchImpl: async url => new Response(null, {
        status: 302,
        headers: { location: String(url).endsWith('/a') ? 'https://radio.example/b' : 'https://radio.example/a' }
      })
    }),
    /redirect loop/
  );

  let hopCount = 0;
  await assert.rejects(
    guardedFetch('https://radio.example/0', {
      deadlineAt: Date.now() + 5000,
      fetchImpl: async () => {
        hopCount += 1;
        return new Response(null, { status: 302, headers: { location: `https://radio.example/${hopCount}` } });
      }
    }),
    /too many redirects/
  );
});

test('readBodyCapped enforces the wall-clock deadline against trickling bodies', async () => {
  const stream = new ReadableStream({
    async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, 60));
      controller.enqueue(new Uint8Array(16));
    }
  });
  const startedAt = Date.now();
  const bytes = await readBodyCapped(new Response(stream), { maxBytes: 1024 * 1024, deadlineAt: Date.now() + 200 });
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 1500, `deadline should stop the read quickly, took ${elapsed}ms`);
  assert.ok(bytes.length < 1024 * 1024);
});

test('the in-function rate limiter blocks after the configured budget', () => {
  const allow = createRateLimiter({ windowMs: 60_000, max: 3 });
  const request = new Request('https://site.example/api/x', { headers: { 'cf-connecting-ip': '198.51.100.7' } });
  assert.ok(allow(request));
  assert.ok(allow(request));
  assert.ok(allow(request));
  assert.equal(allow(request), false);
});

test('fingerprint cache identity includes the normalized country', () => {
  assert.equal(normalizeCountry('kr'), 'KR');
  assert.equal(normalizeCountry('nope'), 'US');
  const us = fingerprintCacheKey('https://ice.example.net/mount', 'US');
  const kr = fingerprintCacheKey('https://ice.example.net/mount', 'KR');
  assert.notEqual(us, kr);
  assert.equal(fingerprintCacheKey('https://ice.example.net/mount', 'nope'), us);
});

test('Pages fingerprinting resolves HLS playlists and samples media segments', async () => {
  const segment = new Uint8Array(40 * 1024).fill(9);
  await withFetch(async target => {
    const url = String(target);
    if (url === 'https://hls.example/live.m3u8') {
      return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nchunks/media.m3u8\n', {
        headers: { 'content-type': 'application/vnd.apple.mpegurl' }
      });
    }
    if (url === 'https://hls.example/chunks/media.m3u8') {
      return new Response('#EXTM3U\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nseg2.ts\n#EXTINF:4,\nseg3.ts\n', {
        headers: { 'content-type': 'application/vnd.apple.mpegurl' }
      });
    }
    if (/seg\d\.ts$/.test(url)) return new Response(segment, { headers: { 'content-type': 'video/mp2t' } });
    if (url === 'https://api.audd.io/') {
      return Response.json({ status: 'success', result: { artist: 'IU', title: 'Blueming' } });
    }
    return new Response('nope', { status: 404 });
  }, async () => {
    const request = new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://hls.example/live.m3u8')}`);
    const body = await (await fingerprintGet2({ request, env: { AUDD_API_TOKEN: 't' } })).json();
    assert.equal(body.found, true);
    assert.equal(body.provider, 'audd');
    assert.equal(body.artist, 'IU');
  });
});

test('slow generic probes still leave budget for a successful ICY fallback', async () => {
  const metaint = 64;
  await withFetch(async (target, init) => {
    const url = String(target);
    if (url.includes('status-json.xsl') || url.includes('stats?json=1')) {
      // Hang until aborted by the stage deadline.
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    if (url === 'https://ice.example.net/mount') {
      return new Response(icyStreamBody(metaint, 'Aespa - Supernova'), { headers: { 'icy-metaint': String(metaint) } });
    }
    return new Response('nope', { status: 404 });
  }, async () => {
    const startedAt = Date.now();
    const body = await resolveNowPlaying('https://ice.example.net/mount', { deadlineAt: Date.now() + 9500 });
    assert.equal(body.found, true);
    assert.equal(body.source, 'icy');
    assert.equal(body.artist, 'Aespa');
    assert.ok(Date.now() - startedAt < 9000, 'ICY fallback must complete inside the shared budget');
  });
});
