// Unit tests for the Cloudflare Pages Functions. They use only Web APIs
// (Request/Response/fetch/streams), all of which exist in Node, so the handlers are
// exercised directly with a stubbed global fetch.

import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet as nowPlayingGet, rejectStreamUrl } from '../functions/api/nowplaying.js';
import { onRequestGet as fingerprintGet } from '../functions/api/track/fingerprint.js';
import { clearIdentifyCache } from '../server/metadata-providers.mjs';
import { extractIcyTitle, icyReadBudget, parseIcyTitle } from '../server/icy-title.mjs';
import { deniedIpv6Vectors, publicIpv6Controls } from './fixtures/public-ip-policy-vectors.mjs';

const realFetch = globalThis.fetch;

function withFetch(impl, run) {
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(run)
    .finally(() => { globalThis.fetch = realFetch; });
}

function withCache(cache, run) {
  const hadCaches = Object.hasOwn(globalThis, 'caches');
  const originalCaches = globalThis.caches;
  globalThis.caches = { default: cache };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (hadCaches) globalThis.caches = originalCaches;
      else delete globalThis.caches;
    });
}

function redirectResponse(location, onCancel = () => {}) {
  return new Response(new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel() { onCancel(); }
  }), { status: 302, headers: { location } });
}

function icyStreamBody(metaint, title) {
  const metadata = `StreamTitle='${title}';`;
  const padded = metadata + '\0'.repeat(16 - (metadata.length % 16 || 16));
  const bytes = new Uint8Array(metaint + 1 + padded.length + 64);
  bytes[metaint] = padded.length / 16;
  new TextEncoder().encodeInto(padded, bytes.subarray(metaint + 1));
  return bytes;
}

function neverEndingResponse(status, onCancel, headers = {}) {
  return new Response(new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel() { onCancel(); }
  }), { status, headers });
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
      assert.equal(new Headers(init.headers).get('icy-metadata'), '1');
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

test('nowplaying parses iHeart current-song text= ICY blobs', async () => {
  const metaint = 64;
  const title = 'Olivia Rodrigo - text="Stupid Song" song_spot="M" MediaBaseId="1"';
  await withFetch(async (target, init) => {
    const url = String(target);
    if (url === 'https://stream.revma.example/zc1') {
      assert.equal(new Headers(init.headers).get('icy-metadata'), '1');
      return new Response(icyStreamBody(metaint, title), { headers: { 'icy-metaint': String(metaint) } });
    }
    return new Response('nope', { status: 404 });
  }, async () => {
    const request = new Request(`https://site.example/api/nowplaying?url=${encodeURIComponent('https://stream.revma.example/zc1')}`);
    const body = await (await nowPlayingGet({ request })).json();
    assert.equal(body.found, true);
    assert.equal(body.artist, 'Olivia Rodrigo');
    assert.equal(body.title, 'Stupid Song');
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

import { createRateLimiter, guardedFetch, readBodyCapped, rejectFetchUrl, validatePublicUrl } from '../functions/_shared/guarded-fetch.js';
import * as guardedFetchBoundary from '../functions/_shared/guarded-fetch.js';
import { fingerprintCacheKey, normalizeCountry, onRequestGet as fingerprintGet2, sampleStream } from '../functions/api/track/fingerprint.js';
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

test('Pages public-target policy matches the Node reserved-address boundary', () => {
  const blocked = [
    'http://localhost/live',
    'http://foo.localhost/live',
    'http://127.1/live',
    'http://0x7f000001/live',
    'http://[::1]/live',
    'http://[::ffff:127.0.0.1]/live',
    'http://192.0.0.1/live',
    'http://192.0.2.1/live',
    'http://198.18.0.1/live',
    'http://198.51.100.7/live',
    'http://203.0.113.9/live',
    'http://[2001:db8::1]/live',
    'http://[fec0::1]/live',
    'http://[::192.0.2.1]/live',
    'https://radio.local/live',
    'https://radio.internal/live'
  ];
  for (const target of blocked) {
    assert.match(rejectFetchUrl(target), /private hosts are blocked/, target);
  }
  assert.match(rejectFetchUrl('https://user:pass@radio.example/live'), /credentials/, 'userinfo must fail closed');
  assert.match(rejectFetchUrl('file:///etc/passwd'), /http\/https/, 'scheme changes must fail closed');
});

test('Pages uses the shared IPv6 vectors for non-global denial and public controls', () => {
  for (const address of deniedIpv6Vectors) {
    assert.equal(rejectFetchUrl(`http://[${address}]/live`), 'private hosts are blocked', address);
  }
  for (const address of publicIpv6Controls) {
    assert.equal(rejectFetchUrl(`http://[${address}]/live`), '', address);
  }
});

test('Pages rejects a special-purpose IPv6 redirect before the second sink call', async () => {
  const calls = [];
  await assert.rejects(
    guardedFetch('https://radio.example/live', {
      fetchImpl: async target => {
        calls.push(String(target));
        if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'http://[100::1]/admin' } });
        return new Response('internal');
      }
    }),
    /private hosts are blocked/
  );
  assert.deepEqual(calls, ['https://radio.example/live']);
});

test('Pages rejects a legacy translated private IPv6 redirect before the second sink call', async () => {
  const calls = [];
  await assert.rejects(
    guardedFetch('https://radio.example/live', {
      fetchImpl: async target => {
        calls.push(String(target));
        if (calls.length === 1) {
          return new Response(null, { status: 302, headers: { location: 'http://[::ffff:0:127.0.0.1]/admin' } });
        }
        return new Response('internal');
      }
    }),
    /private hosts are blocked/
  );
  assert.deepEqual(calls, ['https://radio.example/live']);
});

test('validatePublicUrl rejects canonical same-zone targets', () => {
  const options = { forbiddenOrigins: ['https://SITE.EXAMPLE:443'] };
  assert.throws(() => validatePublicUrl('https://site.example/live', options), /same-zone targets are blocked/);
  assert.throws(() => validatePublicUrl('https://site.example.:443/live', options), /same-zone targets are blocked/);
  assert.equal(validatePublicUrl('https://station.example/live', options).origin, 'https://station.example');
});

test('fetchPublic exposes the approved Response-returning compatibility surface', async () => {
  assert.equal(typeof guardedFetchBoundary.fetchPublic, 'function');
  const calls = [];
  const response = await guardedFetchBoundary.fetchPublic('https://radio.example/live', {
    deadlineAt: Date.now() + 5000,
    fetchImpl: async target => {
      calls.push(String(target));
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: '/final.mp3' } })
        : new Response('audio', { headers: { 'content-type': 'audio/mpeg' } });
    }
  });
  assert.equal(response instanceof Response, true);
  assert.equal(await response.text(), 'audio');
  assert.deepEqual(calls, ['https://radio.example/live', 'https://radio.example/final.mp3']);
});

test('guardedFetch rejects initial and redirected same-zone targets before fetch', async () => {
  let calls = 0;
  await assert.rejects(
    guardedFetch('https://site.example:443/api/nowplaying', {
      deadlineAt: Date.now() + 5000,
      forbiddenOrigins: ['https://SITE.EXAMPLE'],
      fetchImpl: async () => {
        calls += 1;
        return new Response('must not happen');
      }
    }),
    /same-zone targets are blocked/
  );
  assert.equal(calls, 0, 'an initial same-zone target must be rejected before fetch');

  const fetched = [];
  await assert.rejects(
    guardedFetch('https://radio.example/live', {
      deadlineAt: Date.now() + 5000,
      forbiddenOrigins: ['https://site.example'],
      fetchImpl: async target => {
        fetched.push(String(target));
        return new Response(null, { status: 302, headers: { location: 'https://SITE.EXAMPLE:443/api/nowplaying' } });
      }
    }),
    /same-zone targets are blocked/
  );
  assert.deepEqual(fetched, ['https://radio.example/live']);
});

test('both Pages handlers reject their request origin before outbound fetch', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return new Response('must not happen');
  }, async () => {
    const nowplaying = await nowPlayingGet({
      request: new Request(`https://SITE.EXAMPLE:443/api/nowplaying?url=${encodeURIComponent('https://site.example/live')}`)
    });
    assert.equal(nowplaying.status, 400);
    assert.match((await nowplaying.json()).reason, /same-zone targets are blocked/);

    const fingerprint = await fingerprintGet({
      request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://SITE.EXAMPLE:443/live')}`),
      env: { AUDD_API_TOKEN: 'token' }
    });
    assert.equal(fingerprint.status, 400);
    assert.match((await fingerprint.json()).reason, /same-zone targets are blocked/);
  });
  assert.equal(calls, 0);
});

test('the fingerprint handler forwards its request origin to redirect validation', async () => {
  const calls = [];
  await withFetch(async target => {
    calls.push(String(target));
    return new Response(null, {
      status: 302,
      headers: { location: 'https://site.example/api/track/fingerprint' }
    });
  }, async () => {
    const response = await fingerprintGet({
      request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://radio.example/live')}`),
      env: { AUDD_API_TOKEN: 'token' }
    });
    const body = await response.json();
    assert.equal(body.found, false);
    assert.match(body.reason, /same-zone targets are blocked/);
  });
  assert.deepEqual(calls, ['https://radio.example/live']);
});

test('the now-playing handler blocks redirects back to its request origin before the next fetch', async () => {
  const calls = [];
  await withFetch(async target => {
    calls.push(String(target));
    return new Response(null, {
      status: 302,
      headers: { location: 'https://site.example/api/nowplaying' }
    });
  }, async () => {
    const response = await nowPlayingGet({
      request: new Request(`https://site.example/api/nowplaying?url=${encodeURIComponent('https://radio.example/live')}`)
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).found, false);
  });
  assert.ok(calls.length > 0);
  assert.equal(calls.some(target => new URL(target).origin === 'https://site.example'), false);
});

test('guardedFetch revalidates every redirect hop and never fetches a private target', async () => {
  const fetched = [];
  const fetchImpl = async (url, init) => {
    fetched.push({ url: String(url), userAgent: new Headers(init.headers).get('user-agent') || '' });
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
  assert.equal(hopCount, 5, 'four redirects permit exactly five fetch attempts');
});

test('guardedFetch applies one absolute deadline across multiple redirects', async () => {
  let calls = 0;
  const startedAt = Date.now();
  await assert.rejects(
    guardedFetch('https://radio.example/0', {
      deadlineAt: startedAt + 130,
      maxRedirects: 10,
      fetchImpl: async () => {
        calls += 1;
        await new Promise(resolve => setTimeout(resolve, 70));
        return new Response(null, { status: 302, headers: { location: `https://radio.example/${calls}` } });
      }
    }),
    /deadline/
  );
  assert.equal(calls, 2);
  assert.ok(Date.now() - startedAt < 350, 'redirect progress must not reset the deadline');
});

test('guardedFetch validates reserved redirect targets before the second fetch', async () => {
  const blocked = [
    'http://foo.localhost/admin',
    'http://192.0.2.1/admin',
    'http://198.18.0.1/admin',
    'http://[2001:db8::1]/admin',
    'http://[fec0::1]/admin',
    'https://user:pass@radio.example/admin',
    'file:///etc/passwd'
  ];
  for (const location of blocked) {
    const calls = [];
    await assert.rejects(
      guardedFetch('https://radio.example/live', {
        deadlineAt: Date.now() + 5000,
        fetchImpl: async target => {
          calls.push(String(target));
          return new Response(null, { status: 302, headers: { location } });
        }
      }),
      /private hosts are blocked|credentials|http\/https/,
      location
    );
    assert.deepEqual(calls, ['https://radio.example/live'], location);
  }

  const publicCalls = [];
  const publicResult = await guardedFetch('https://radio.example/path/start', {
    deadlineAt: Date.now() + 5000,
    fetchImpl: async target => {
      publicCalls.push(String(target));
      return publicCalls.length === 1
        ? new Response(null, { status: 302, headers: { location: '../live.mp3' } })
        : new Response('audio');
    }
  });
  assert.equal(publicResult.finalUrl, 'https://radio.example/live.mp3');
  assert.deepEqual(publicCalls, ['https://radio.example/path/start', 'https://radio.example/live.mp3']);
});

test('guardedFetch supplies one default User-Agent and honors case-insensitive overrides', async () => {
  const seen = [];
  const fetchImpl = async (_target, init) => {
    const entries = [...new Headers(init.headers).entries()].filter(([name]) => name.toLowerCase() === 'user-agent');
    seen.push(entries);
    return new Response('ok');
  };
  await guardedFetch('https://radio.example/default', { deadlineAt: Date.now() + 5000, fetchImpl });
  await guardedFetch('https://radio.example/object', {
    deadlineAt: Date.now() + 5000,
    fetchImpl,
    headers: { 'user-agent': 'Object override' }
  });
  await guardedFetch('https://radio.example/headers', {
    deadlineAt: Date.now() + 5000,
    fetchImpl,
    headers: new Headers({ 'USER-AGENT': 'Headers override' })
  });
  assert.deepEqual(seen, [
    [['user-agent', 'EarthRadio/0.24.0 pages-fn (+https://github.com/Protonmatter/EarthRadio)']],
    [['user-agent', 'Object override']],
    [['user-agent', 'Headers override']]
  ]);
});

test('an expired guardedFetch deadline performs zero fetches', async () => {
  let calls = 0;
  await assert.rejects(
    guardedFetch('https://radio.example/live', {
      deadlineAt: Date.now() - 1,
      fetchImpl: async () => {
        calls += 1;
        return new Response('must not happen');
      }
    }),
    /deadline/
  );
  assert.equal(calls, 0);
});

test('readBodyCapped enforces the wall-clock deadline against trickling bodies', async () => {
  const stream = new ReadableStream({
    async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, 60));
      controller.enqueue(new Uint8Array(16));
    }
  });
  const startedAt = Date.now();
  await assert.rejects(
    readBodyCapped(new Response(stream), { maxBytes: 1024 * 1024, deadlineAt: Date.now() + 200 }),
    /deadline/
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 1500, `deadline should stop the read quickly, took ${elapsed}ms`);
});

test('readBodyCapped hard-stops a stalled body after headers and cancels its reader', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel() { cancelled = true; }
  });
  const startedAt = Date.now();
  await assert.rejects(
    readBodyCapped(new Response(stream), { maxBytes: 1024, deadlineAt: startedAt + 80 }),
    /deadline/
  );
  assert.ok(Date.now() - startedAt < 500, 'a stalled body read must share the absolute deadline');
  assert.equal(cancelled, true);
});

test('readBodyCapped slices the terminal chunk exactly and cancels the reader', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(100).fill(7)); },
    cancel() { cancelled = true; }
  });
  const bytes = await readBodyCapped(new Response(stream), { maxBytes: 10, deadlineAt: Date.now() + 5000 });
  assert.equal(bytes.length, 10);
  assert.deepEqual([...bytes], new Array(10).fill(7));
  assert.equal(cancelled, true);
});

test('an expired body deadline performs zero reads and cancels the reader', async () => {
  let reads = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      reads += 1;
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() { cancelled = true; }
  });
  await assert.rejects(
    readBodyCapped(new Response(stream), { maxBytes: 10, deadlineAt: Date.now() - 1 }),
    /deadline/
  );
  assert.equal(reads, 0);
  assert.equal(cancelled, true);
});

test('readBodyCapped accepts stopOn and rejects an ambiguous stop callback alias', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    }
  });
  const bytes = await readBodyCapped(new Response(stream), {
    maxBytes: 10,
    deadlineAt: Date.now() + 5000,
    stopOn: ({ length }) => length >= 2
  });
  assert.deepEqual([...bytes], [1, 2]);

  await assert.rejects(
    readBodyCapped(new Response('audio'), {
      maxBytes: 10,
      deadlineAt: Date.now() + 5000,
      stopOn: () => true,
      stopWhen: () => true
    }),
    /only one of stopOn or stopWhen/
  );
});

test('now-playing cancels every non-2xx response body it does not consume', async () => {
  let fetched = 0;
  let cancelled = 0;
  await withFetch(async () => {
    fetched += 1;
    return neverEndingResponse(503, () => { cancelled += 1; });
  }, async () => {
    const result = await resolveNowPlaying('https://radio.example/live', { deadlineAt: Date.now() + 9000 });
    assert.equal(result.found, false);
  });
  assert.ok(fetched > 0);
  assert.equal(cancelled, fetched);
});

test('fingerprinting cancels a non-2xx stream body before reporting sampling failure', async () => {
  let cancelled = false;
  await withFetch(async target => {
    assert.equal(String(target), 'https://radio.example/live');
    return neverEndingResponse(503, () => { cancelled = true; });
  }, async () => {
    const response = await fingerprintGet({
      request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://radio.example/live')}`),
      env: { AUDD_API_TOKEN: 'token' }
    });
    assert.match((await response.json()).reason, /stream HTTP 503/);
  });
  assert.equal(cancelled, true);
});

test('fingerprinting cancels an unsupported successful stream body', async () => {
  let cancelled = false;
  await withFetch(async () => neverEndingResponse(200, () => { cancelled = true; }, { 'content-type': 'text/html' }), async () => {
    const response = await fingerprintGet({
      request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://radio.example/page')}`),
      env: { AUDD_API_TOKEN: 'token' }
    });
    assert.match((await response.json()).reason, /unsupported content-type/);
  });
  assert.equal(cancelled, true);
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

test('fingerprint route normalizes country before cache identity and catalog enrichment', async () => {
  clearIdentifyCache();
  const stored = new Map();
  const catalogCountries = [];
  let recognitionCalls = 0;
  const cache = {
    async match(request) { return stored.get(request.url)?.clone(); },
    async put(request, response) { stored.set(request.url, response.clone()); }
  };
  const sample = new Uint8Array(96 * 1024).fill(7);

  await withCache(cache, () => withFetch(async target => {
    const url = new URL(String(target));
    if (url.origin === 'https://ice.example.net') {
      return new Response(sample, { headers: { 'content-type': 'audio/mpeg' } });
    }
    if (url.href === 'https://api.audd.io/') {
      recognitionCalls += 1;
      return Response.json({ status: 'success', result: { artist: 'IU', title: 'Blueming' } });
    }
    if (url.origin === 'https://itunes.apple.com') {
      const country = url.searchParams.get('country');
      catalogCountries.push(country);
      return Response.json({ results: [{
        trackId: country === 'KR' ? 82 : 1,
        artistName: 'IU',
        trackName: 'Blueming',
        collectionName: `${country} catalog`,
        trackTimeMillis: 217000
      }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const route = country => fingerprintGet({
      request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://ice.example.net/live')}&country=${encodeURIComponent(country)}`),
      env: { AUDD_API_TOKEN: 'token' }
    });
    const kr = await (await route('kr')).json();
    const us = await (await route('US')).json();
    const invalid = await (await route('not-a-country')).json();

    assert.equal(kr.country, 'KR');
    assert.equal(kr.album, 'KR catalog');
    assert.equal(us.country, 'US');
    assert.equal(us.album, 'US catalog');
    assert.deepEqual(invalid, us, 'invalid country must reuse the normalized US cache entry');
  }));

  assert.equal(stored.size, 2);
  assert.deepEqual([...stored.keys()].sort(), [
    fingerprintCacheKey('https://ice.example.net/live', 'KR'),
    fingerprintCacheKey('https://ice.example.net/live', 'US')
  ].sort());
  assert.deepEqual(catalogCountries.sort(), ['KR', 'US']);
  assert.equal(recognitionCalls, 2);
  clearIdentifyCache();
});

test('Pages catalog enrichment stays inside the fingerprint operation deadline', async () => {
  clearIdentifyCache();
  const realNow = Date.now;
  const realSetTimeout = globalThis.setTimeout;
  let clock = 1_000_000;
  let fingerprintAnswered = false;
  const postFingerprintTimers = [];
  Date.now = () => clock;
  globalThis.setTimeout = (handler, delay, ...args) => {
    if (fingerprintAnswered) postFingerprintTimers.push(Number(delay));
    return realSetTimeout(handler, delay, ...args);
  };
  try {
    await withFetch(async target => {
      const url = String(target);
      if (url === 'https://ice.example.net/deadline-catalog') {
        return new Response(new Uint8Array(128 * 1024).fill(7), {
          headers: { 'content-type': 'audio/mpeg', 'icy-br': '128' }
        });
      }
      if (url === 'https://api.audd.io/') {
        // Sampling and recognition have consumed all but 500ms of the route's
        // 40-second operation budget.
        clock += 39_500;
        fingerprintAnswered = true;
        return Response.json({
          status: 'success',
          result: { artist: 'IU', title: 'Blueming', album: '', release_date: '2019-11-18' }
        });
      }
      if (url.startsWith('https://itunes.apple.com/search?')) {
        return Response.json({ results: [{
          trackId: 1,
          artistName: 'IU',
          trackName: 'Blueming',
          collectionName: 'Love Poem',
          releaseDate: '2019-11-18T00:00:00Z'
        }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }, async () => {
      const response = await fingerprintGet({
        request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://ice.example.net/deadline-catalog')}`),
        env: { AUDD_API_TOKEN: 'token' }
      });
      assert.equal((await response.json()).found, true);
    });
  } finally {
    Date.now = realNow;
    globalThis.setTimeout = realSetTimeout;
    clearIdentifyCache();
  }
  assert.ok(postFingerprintTimers.length > 0, 'catalog lookup did not install a bounded timer');
  assert.ok(
    Math.max(...postFingerprintTimers) <= 500,
    `catalog enrichment escaped the original deadline with ${Math.max(...postFingerprintTimers)}ms remaining timer`
  );
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

test('Pages HLS sampling allows exactly 16 stream attempts and keeps the provider POST outside the budget', async () => {
  const streamAttempts = [];
  const segment = new Uint8Array(96 * 1024).fill(9);
  let providerCalls = 0;
  const redirectChains = new Map();
  for (const prefix of ['master', 'variant', 'nested']) {
    for (let index = 0; index < 4; index += 1) {
      const current = index === 0 ? `${prefix}.m3u8` : `${prefix}-r${index}.m3u8`;
      redirectChains.set(`https://hls.example/${current}`, `${prefix}-r${index + 1}.m3u8`);
    }
  }

  await withFetch(async (target, init) => {
    const url = String(target);
    if (url.startsWith('https://hls.example/')) {
      streamAttempts.push(url);
      assert.equal(init.redirect, 'manual');
      const userAgents = [...new Headers(init.headers).entries()].filter(([name]) => name.toLowerCase() === 'user-agent');
      assert.equal(userAgents.length, 1, `${url} must have exactly one User-Agent`);
      assert.match(userAgents[0][1], /^EarthRadio\//i);
      const location = redirectChains.get(url);
      if (location) return redirectResponse(location);
      if (url.endsWith('/master-r4.m3u8')) {
        return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nvariant.m3u8\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      if (url.endsWith('/variant-r4.m3u8')) {
        return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nnested.m3u8\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      if (url.endsWith('/nested-r4.m3u8')) {
        return new Response('#EXTM3U\n#EXTINF:4,\nonly.ts\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      if (url.endsWith('/only.ts')) return new Response(segment, { headers: { 'content-type': 'video/mp2t' } });
    }
    if (url === 'https://api.audd.io/') {
      providerCalls += 1;
      return Response.json({ status: 'success', result: { artist: 'IU', title: 'Blueming' } });
    }
    if (url.startsWith('https://itunes.apple.com/')) return Response.json({ results: [] });
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const response = await fingerprintGet({
      request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://hls.example/master.m3u8')}`),
      env: { AUDD_API_TOKEN: 'token' }
    });
    assert.equal((await response.json()).found, true);
  });

  assert.equal(streamAttempts.length, 16);
  assert.equal(providerCalls, 1, 'the fixed recognition-provider POST is outside the stream budget');
});

test('exported sampleStream preserves its injected absolute deadline and cancels a stalled partial segment', async () => {
  assert.equal(typeof sampleStream, 'function');
  let cancelled = false;
  let providerCalls = 0;
  const partial = new Uint8Array(20 * 1024).fill(3);
  const startedAt = Date.now();
  await withFetch(async target => {
    const url = String(target);
    if (url.endsWith('/direct.m3u8')) {
      return new Response('#EXTM3U\n#EXTINF:4,\npartial.ts\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    if (url.endsWith('/partial.ts')) {
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(partial); },
        pull() { return new Promise(() => {}); },
        cancel() { cancelled = true; }
      }));
    }
    if (url === 'https://api.audd.io/') providerCalls += 1;
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    await assert.rejects(
      sampleStream('https://hls.example/direct.m3u8', { deadlineAt: startedAt + 80 }),
      /deadline/i
    );
  });
  assert.ok(Date.now() - startedAt < 500, 'the injected deadline must not be replaced by a fresh 20-second budget');
  assert.equal(cancelled, true);
  assert.equal(providerCalls, 0);
});

test('Pages HLS sampling fails closed before a 17th stream attempt and does not recognize or cache the limit result', async () => {
  const streamAttempts = [];
  let sixteenthBodyCancelled = false;
  let providerCalls = 0;
  let cachePuts = 0;
  const cache = {
    async match() { return undefined; },
    async put() { cachePuts += 1; }
  };
  const redirectChains = new Map();
  for (const prefix of ['master', 'variant', 'nested']) {
    for (let index = 0; index < 4; index += 1) {
      const current = index === 0 ? `${prefix}.m3u8` : `${prefix}-r${index}.m3u8`;
      redirectChains.set(`https://hls.example/${current}`, `${prefix}-r${index + 1}.m3u8`);
    }
  }

  await withCache(cache, () => withFetch(async target => {
    const url = String(target);
    if (url.startsWith('https://hls.example/')) {
      streamAttempts.push(url);
      const location = redirectChains.get(url);
      if (location) return redirectResponse(location);
      if (url.endsWith('/master-r4.m3u8')) {
        return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nvariant.m3u8\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      if (url.endsWith('/variant-r4.m3u8')) {
        return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nnested.m3u8\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      if (url.endsWith('/nested-r4.m3u8')) {
        return new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nseg1.m4s\n#EXTINF:4,\nseg2.m4s\n#EXTINF:4,\nseg3.m4s\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      if (url.endsWith('/init.mp4')) {
        return redirectResponse('init-final.mp4', () => { sixteenthBodyCancelled = true; });
      }
      if (/init-final\.mp4$|seg\d\.m4s$/.test(url)) return new Response(new Uint8Array(96 * 1024));
    }
    if (url === 'https://api.audd.io/') {
      providerCalls += 1;
      return Response.json({ status: 'success', result: { artist: 'IU', title: 'Blueming' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const response = await fingerprintGet({
      request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://hls.example/master.m3u8')}`),
      env: { AUDD_API_TOKEN: 'token' }
    });
    const body = await response.json();
    assert.equal(body.found, false);
    assert.match(body.reason, /attempt limit/i);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }));

  assert.equal(streamAttempts.length, 16);
  assert.equal(sixteenthBodyCancelled, true);
  assert.equal(providerCalls, 0);
  assert.equal(cachePuts, 0);
});

test('Pages HLS sampling uses one init, the three most recent segments, and at most 1 MiB', async () => {
  const hlsRequests = [];
  let providerSampleBytes = 0;
  const oversized = new Uint8Array(600 * 1024).fill(5);
  await withFetch(async (target, init) => {
    const url = String(target);
    if (url.startsWith('https://hls.example/')) {
      hlsRequests.push(url);
      const userAgents = [...new Headers(init.headers).entries()].filter(([name]) => name.toLowerCase() === 'user-agent');
      assert.equal(userAgents.length, 1);
      assert.match(userAgents[0][1], /^EarthRadio\//i);
      if (url.endsWith('/bounded.m3u8')) {
        return new Response('#EXTM3U\n#EXT-X-MAP:URI="init-a.mp4"\n#EXT-X-MAP:URI="init-b.mp4"\n#EXTINF:4,\nseg1.m4s\n#EXTINF:4,\nseg2.m4s\n#EXTINF:4,\nseg3.m4s\n#EXTINF:4,\nseg4.m4s\n#EXTINF:4,\nseg5.m4s\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      return new Response(oversized, { headers: { 'content-type': 'video/mp4' } });
    }
    if (url === 'https://api.audd.io/') {
      providerSampleBytes = init.body.get('file').size;
      return Response.json({ status: 'success', result: { artist: 'IU', title: 'Blueming' } });
    }
    if (url.startsWith('https://itunes.apple.com/')) return Response.json({ results: [] });
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const response = await fingerprintGet({
      request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://hls.example/bounded.m3u8')}`),
      env: { AUDD_API_TOKEN: 'token' }
    });
    assert.equal((await response.json()).found, true);
  });

  assert.deepEqual(hlsRequests, [
    'https://hls.example/bounded.m3u8',
    'https://hls.example/init-b.mp4',
    'https://hls.example/seg3.m4s',
    'https://hls.example/seg4.m4s',
    'https://hls.example/seg5.m4s'
  ]);
  assert.equal(providerSampleBytes, 1024 * 1024);
});

test('Pages HLS keeps only the coherent suffix after a map transition inside the recent window', async () => {
  const fetched = [];
  await withFetch(async target => {
    const url = String(target);
    fetched.push(url);
    if (url.endsWith('/transition.m3u8')) {
      return new Response('#EXTM3U\n#EXT-X-MAP:URI="init-a.mp4"\n#EXTINF:4,\nseg1.m4s\n#EXTINF:4,\nseg2.m4s\n#EXTINF:4,\nseg3.m4s\n#EXT-X-MAP:URI="init-b.mp4"\n#EXTINF:4,\nseg4.m4s\n#EXTINF:4,\nseg5.m4s\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    return new Response(new Uint8Array(20 * 1024).fill(6));
  }, async () => {
    const bytes = await sampleStream('https://hls.example/transition.m3u8', { deadlineAt: Date.now() + 1000 });
    assert.equal(bytes.length, 60 * 1024);
  });
  assert.deepEqual(fetched, [
    'https://hls.example/transition.m3u8',
    'https://hls.example/init-b.mp4',
    'https://hls.example/seg4.m4s',
    'https://hls.example/seg5.m4s'
  ]);
});

test('Pages HLS validates private redirects at master, variant, init, and media stages', async () => {
  const cases = [
    { stage: 'master', playlist: () => redirectResponse('http://127.0.0.1/master.m3u8') },
    {
      stage: 'variant',
      playlist: url => url.endsWith('/private-variant.m3u8')
        ? redirectResponse('http://127.0.0.1/variant.m3u8')
        : new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nprivate-variant.m3u8\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } })
    },
    {
      stage: 'init',
      playlist: url => url.endsWith('/init.mp4')
        ? redirectResponse('http://127.0.0.1/init.mp4')
        : url.endsWith('/segment.m4s')
          ? new Response('missing', { status: 404 })
          : new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nsegment.m4s\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } })
    },
    {
      stage: 'media',
      playlist: url => url.endsWith('/segment.ts')
        ? redirectResponse('http://127.0.0.1/segment.ts')
        : new Response('#EXTM3U\n#EXTINF:4,\nsegment.ts\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } })
    }
  ];

  for (const { stage, playlist } of cases) {
    let privateFetches = 0;
    let providerCalls = 0;
    let redirectBodiesCancelled = 0;
    await withFetch(async target => {
      const url = String(target);
      if (url.startsWith('http://127.0.0.1/')) {
        privateFetches += 1;
        return new Response('must not happen');
      }
      if (url === 'https://api.audd.io/') {
        providerCalls += 1;
        return Response.json({ status: 'success', result: { artist: 'IU', title: 'Blueming' } });
      }
      const response = playlist(url);
      if (response.status === 302) {
        return redirectResponse(response.headers.get('location'), () => { redirectBodiesCancelled += 1; });
      }
      return response;
    }, async () => {
      const response = await fingerprintGet({
        request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent(`https://hls.example/${stage}.m3u8`)}`),
        env: { AUDD_API_TOKEN: 'token' }
      });
      assert.equal((await response.json()).found, false, stage);
    });
    assert.equal(privateFetches, 0, stage);
    assert.equal(providerCalls, 0, stage);
    assert.equal(redirectBodiesCancelled, 1, stage);
  }
});

test('Pages HLS rejects translated private init and segment URLs before fetch', async () => {
  const outcomes = [];
  for (const stage of ['init', 'segment']) {
    const calls = [];
    const playlistUrl = `https://8.8.8.8/translated-${stage}.m3u8`;
    const translatedUrl = `http://[::ffff:0:127.0.0.1]/${stage}.mp4`;
    const playlist = stage === 'init'
      ? `#EXTM3U\n#EXT-X-MAP:URI="${translatedUrl}"\n#EXTINF:4,\nhttps://8.8.4.4/segment.m4s\n`
      : `#EXTM3U\n#EXTINF:4,\n${translatedUrl}\n`;
    let error;
    await withFetch(async target => {
      const url = String(target);
      calls.push(url);
      if (url === playlistUrl) {
        return new Response(playlist, { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'video/mp4' } });
    }, async () => {
      try {
        await sampleStream(playlistUrl, { deadlineAt: Date.now() + 1000 });
      } catch (caught) {
        error = caught;
      }
    });
    outcomes.push({ stage, calls, error });
  }

  // A rejected initialization segment is terminal (matching the Node sampler):
  // fragments without their EXT-X-MAP metadata are undecodable, so continuing would
  // spend recognition quota on a predictable miss. The private target is still never
  // fetched, and neither is the now-pointless media segment.
  assert.deepEqual(outcomes[0].calls, ['https://8.8.8.8/translated-init.m3u8'], 'init');
  assert.match(outcomes[0].error?.message || '', /private|blocked/, 'init');
  assert.deepEqual(outcomes[1].calls, ['https://8.8.8.8/translated-segment.m3u8'], 'segment');
  assert.match(outcomes[1].error?.message || '', /no HLS segments/, 'segment');
});

test('Pages HLS preserves a legacy translated IPv6 init with a public IPv4 suffix', async () => {
  const calls = [];
  const playlistUrl = 'https://8.8.8.8/public-translated.m3u8';
  const playlist = '#EXTM3U\n#EXT-X-MAP:URI="http://[::ffff:0:8.8.8.8]/init.mp4"\n#EXTINF:4,\nhttps://8.8.4.4/segment.m4s\n';
  await withFetch(async target => {
    const url = String(target);
    calls.push(url);
    if (url === playlistUrl) {
      return new Response(playlist, { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'video/mp4' } });
  }, async () => {
    const sample = await sampleStream(playlistUrl, { deadlineAt: Date.now() + 1000 });
    assert.equal(sample.length, 8);
  });
  assert.deepEqual(calls, [
    playlistUrl,
    'http://[::ffff:0:808:808]/init.mp4',
    'https://8.8.4.4/segment.m4s'
  ]);
});

test('Pages HLS stalled body after partial audio cancels on the clock and does not recognize or cache', async () => {
  let providerCalls = 0;
  let cachePuts = 0;
  let stalledBodyCancelled = false;
  const cache = {
    async match() { return undefined; },
    async put() { cachePuts += 1; }
  };
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (handler, delay, ...args) => realSetTimeout(handler, Math.min(Number(delay) || 0, 60), ...args);
  const startedAt = Date.now();
  try {
    await withCache(cache, () => withFetch(async target => {
      const url = String(target);
      if (url.endsWith('/deadline.m3u8')) {
        return new Response('#EXTM3U\n#EXTINF:4,\nfirst.ts\n#EXTINF:4,\nstalled.ts\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      if (url.endsWith('/first.ts')) return new Response(new Uint8Array(96 * 1024).fill(4));
      if (url.endsWith('/stalled.ts')) {
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new Uint8Array(20 * 1024).fill(8)); },
          pull() { return new Promise(() => {}); },
          cancel() { stalledBodyCancelled = true; }
        }));
      }
      if (url === 'https://api.audd.io/') {
        providerCalls += 1;
        return Response.json({ status: 'success', result: { artist: 'IU', title: 'Blueming' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }, async () => {
      const response = await fingerprintGet({
        request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://hls.example/deadline.m3u8')}`),
        env: { AUDD_API_TOKEN: 'token' }
      });
      assert.match((await response.json()).reason, /deadline/i);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }));
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(stalledBodyCancelled, true);
  assert.equal(providerCalls, 0);
  assert.equal(cachePuts, 0);
});

test('Pages fingerprinting cancels a non-2xx HLS variant body', async () => {
  let cancelled = false;
  await withFetch(async target => {
    const url = String(target);
    if (url === 'https://hls.example/live.m3u8') {
      return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nvariant.m3u8\n', {
        headers: { 'content-type': 'application/vnd.apple.mpegurl' }
      });
    }
    if (url === 'https://hls.example/variant.m3u8') {
      return neverEndingResponse(503, () => { cancelled = true; }, { 'content-type': 'application/vnd.apple.mpegurl' });
    }
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const response = await fingerprintGet({
      request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://hls.example/live.m3u8')}`),
      env: { AUDD_API_TOKEN: 'token' }
    });
    assert.match((await response.json()).reason, /HLS playlist HTTP 503/);
  });
  assert.equal(cancelled, true);
});

test('Pages fingerprinting cancels non-2xx HLS media-segment bodies', async () => {
  let cancelled = false;
  await withFetch(async target => {
    const url = String(target);
    if (url === 'https://hls.example/media.m3u8') {
      return new Response('#EXTM3U\n#EXTINF:4,\nsegment.ts\n', {
        headers: { 'content-type': 'application/vnd.apple.mpegurl' }
      });
    }
    if (url === 'https://hls.example/segment.ts') {
      return neverEndingResponse(404, () => { cancelled = true; }, { 'content-type': 'video/mp2t' });
    }
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const response = await fingerprintGet({
      request: new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://hls.example/media.m3u8')}`),
      env: { AUDD_API_TOKEN: 'token' }
    });
    assert.match((await response.json()).reason, /no HLS segments/);
  });
  assert.equal(cancelled, true);
});

test('slow generic probes still leave budget for a successful ICY fallback', async () => {
  const metaint = 64;
  let stalledBodiesCancelled = 0;
  let icyStartedAt = 0;
  await withFetch(async target => {
    const url = String(target);
    if (url.includes('status-json.xsl') || url.includes('stats?json=1')) {
      // Headers arrive immediately, then each body stalls until the shared stage
      // deadline. Neither stalled read may consume the ICY reserve.
      return neverEndingResponse(200, () => { stalledBodiesCancelled += 1; }, { 'content-type': 'application/json' });
    }
    if (url === 'https://ice.example.net/mount') {
      icyStartedAt = Date.now();
      return new Response(icyStreamBody(metaint, 'IU - Blueming'), { headers: { 'icy-metaint': String(metaint) } });
    }
    return new Response('nope', { status: 404 });
  }, async () => {
    const startedAt = Date.now();
    const body = await resolveNowPlaying('https://ice.example.net/mount', { deadlineAt: Date.now() + 9500 });
    assert.equal(body.found, true);
    assert.equal(body.source, 'icy');
    assert.equal(body.artist, 'IU');
    assert.equal(body.title, 'Blueming');
    assert.ok(icyStartedAt - startedAt < 3000, 'stalled platform bodies must not consume the ICY reserve');
    assert.ok(Date.now() - startedAt < 9000, 'ICY fallback must complete inside the shared budget');
  });
  assert.equal(stalledBodiesCancelled, 2);
});

test('now-playing route owns an 11-second deadline and does not cache terminal ICY timeout', async () => {
  const realDateNow = Date.now;
  const baseNow = realDateNow();
  let clockOffset = 0;
  let icyCalls = 0;
  let icyBodyCancelled = false;
  let cachePuts = 0;
  const cache = {
    async match() { return undefined; },
    async put() { cachePuts += 1; }
  };
  Date.now = () => baseNow + clockOffset;
  try {
    await withCache(cache, () => withFetch(async target => {
      const url = String(target);
      if (url.includes('status-json.xsl') || url.includes('stats?json=1')) {
        return new Response('missing', { status: 404 });
      }
      if (url === 'https://ice.example.net/deadline') {
        icyCalls += 1;
        clockOffset = 11_001;
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(icyStreamBody(64, 'IU - Blueming')); },
          cancel() { icyBodyCancelled = true; }
        }), { headers: { 'icy-metaint': '64' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }, async () => {
      const response = await nowPlayingGet({
        request: new Request(`https://site.example/api/nowplaying?url=${encodeURIComponent('https://ice.example.net/deadline')}`, {
          headers: { 'cf-connecting-ip': '203.0.114.77' }
        })
      });
      const body = await response.json();
      assert.equal(body.found, false);
      assert.equal(body.timeout, true);
      assert.match(body.reason, /deadline|timeout/i);
      assert.ok(body.attempted.includes('icy'));
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }));
  } finally {
    Date.now = realDateNow;
  }
  assert.equal(icyCalls, 1);
  assert.equal(icyBodyCancelled, true);
  assert.equal(cachePuts, 0);
});

test('Pages guard rejects the unspecified IPv6 address and hex-mapped loopback', () => {
  assert.equal(rejectFetchUrl('http://[::]/x'), 'private hosts are blocked');
  assert.equal(rejectFetchUrl('http://[::ffff:7f00:1]/x'), 'private hosts are blocked');
});

test('Pages fingerprinting includes the EXT-X-MAP init segment and reports provider outages', async () => {
  const fetchedUrls = [];
  const segment = new Uint8Array(20 * 1024).fill(9);
  let providerBodyCancelled = false;
  await withFetch(async target => {
    const url = String(target);
    fetchedUrls.push(url);
    if (url === 'https://hls.example/fmp4.m3u8') {
      return new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nseg1.m4s\n#EXTINF:4,\nseg2.m4s\n', {
        headers: { 'content-type': 'application/vnd.apple.mpegurl' }
      });
    }
    if (/init\.mp4$|seg\d\.m4s$/.test(url)) return new Response(segment, { headers: { 'content-type': 'video/mp4' } });
    if (url === 'https://api.audd.io/') {
      return neverEndingResponse(503, () => { providerBodyCancelled = true; });
    }
    return new Response('nope', { status: 404 });
  }, async () => {
    const request = new Request(`https://site.example/api/track/fingerprint?url=${encodeURIComponent('https://hls.example/fmp4.m3u8')}`);
    const body = await (await fingerprintGet2({ request, env: { AUDD_API_TOKEN: 't' } })).json();
    // The init segment was fetched ahead of the media segments...
    assert.ok(fetchedUrls.some(url => url.endsWith('/init.mp4')), 'init segment must be fetched');
    // ...and the provider 503 is an outage, never a negative identification.
    assert.equal(body.found, false);
    assert.equal(body.providerError, true);
    assert.match(body.reason, /unavailable/);
    assert.equal(providerBodyCancelled, true);
  });
});

test('Pages HLS sampling honors byte ranges on map and segment fetches', async () => {
  const ranges = [];
  await withFetch(async (target, init) => {
    const url = String(target);
    if (url.endsWith('/live.m3u8')) {
      return new Response([
        '#EXTM3U',
        '#EXT-X-MAP:URI="media.mp4",BYTERANGE="500@0"',
        '#EXT-X-BYTERANGE:1000@500',
        'media.mp4',
        // Offset-less continuation: starts where the previous sub-range ended.
        '#EXT-X-BYTERANGE:1000',
        'media.mp4',
        '#EXT-X-ENDLIST'
      ].join('\n'), { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    if (url.endsWith('/media.mp4')) {
      ranges.push(new Headers(init?.headers).get('range') || '');
      return new Response(new Uint8Array(2048).fill(7), { status: 206, headers: { 'content-type': 'video/mp4' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const sample = await sampleStream('https://hls.example.net/live.m3u8');
    assert.ok(sample.length > 0);
  });
  assert.deepEqual(ranges, ['bytes=0-499', 'bytes=500-1499', 'bytes=1500-2499']);
});

test('Pages HLS sampling honors offset-less EXT-X-MAP byte ranges', async () => {
  const ranges = [];
  await withFetch(async (target, init) => {
    const url = String(target);
    if (url.endsWith('/live.m3u8')) {
      return new Response([
        '#EXTM3U',
        '#EXT-X-MAP:URI="media.mp4",BYTERANGE="500"',
        '#EXT-X-BYTERANGE:1000',
        'media.mp4',
        '#EXT-X-BYTERANGE:1000',
        'media.mp4',
        '#EXT-X-ENDLIST'
      ].join('\n'), { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    if (url.endsWith('/media.mp4')) {
      ranges.push(new Headers(init?.headers).get('range') || '');
      return new Response(new Uint8Array(2048).fill(7), { status: 206, headers: { 'content-type': 'video/mp4' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const sample = await sampleStream('https://hls.example.net/live.m3u8');
    assert.ok(sample.length > 0);
  });
  assert.deepEqual(ranges, ['bytes=0-499', 'bytes=500-1499', 'bytes=1500-2499']);
});

test('Pages HLS sampling rejects ranged 200 responses that ignore Range', async () => {
  await withFetch(async (target, init) => {
    const url = String(target);
    if (url.endsWith('/live.m3u8')) {
      return new Response(
        '#EXTM3U\n#EXT-X-MAP:URI="media.mp4",BYTERANGE="500@0"\n#EXTINF:4,\n#EXT-X-BYTERANGE:1000@500\nmedia.mp4\n',
        { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }
      );
    }
    if (url.endsWith('/media.mp4')) {
      assert.ok(new Headers(init?.headers).get('range'), 'Range must be requested');
      return new Response(new Uint8Array(4096).fill(7), { status: 200, headers: { 'content-type': 'video/mp4' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    await assert.rejects(sampleStream('https://hls.example.net/live.m3u8'), /initialization segment/i);
  });
});

test('Pages encrypted HLS playlists are rejected before any segment fetch', async () => {
  let segmentFetches = 0;
  await withFetch(async target => {
    const url = String(target);
    if (url.endsWith('/enc.m3u8')) {
      return new Response(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nseg2.ts\n',
        { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }
      );
    }
    segmentFetches += 1;
    return new Response(new Uint8Array(16));
  }, async () => {
    await assert.rejects(sampleStream('https://hls.example.net/enc.m3u8'), /encrypted/i);
  });
  assert.equal(segmentFetches, 0, 'ciphertext must never be fetched or submitted to recognizers');
});

test('Pages HLS sampling fails when the initialization segment cannot be fetched', async () => {
  await withFetch(async target => {
    const url = String(target);
    if (url.endsWith('/live.m3u8')) {
      return new Response(
        '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nseg1.m4s\n#EXTINF:4,\nseg2.m4s\n',
        { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }
      );
    }
    if (url.endsWith('/init.mp4')) return new Response('', { status: 404 });
    return new Response(new Uint8Array(64).fill(7), { headers: { 'content-type': 'video/mp4' } });
  }, async () => {
    // Fragments without their EXT-X-MAP metadata are undecodable: the sampler must
    // fail rather than submit them and spend recognition quota on a predictable miss.
    await assert.rejects(sampleStream('https://hls.example.net/live.m3u8'), /initialization segment/i);
  });
});

test('the in-isolate rate limiter stays bounded under distributed client IPs', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, maxBuckets: 4 });
  const req = ip => new Request('https://site.example/api/nowplaying', { headers: { 'cf-connecting-ip': ip } });
  assert.equal(limiter(req('10.0.0.1')), true);
  assert.equal(limiter(req('10.0.0.1')), false, 'a live bucket still enforces its window');
  for (const ip of ['10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5']) {
    assert.equal(limiter(req(ip)), true, `${ip} must be admitted while the map stays bounded`);
  }
  // The map was full of live buckets when 10.0.0.5 arrived, so the bucket closest
  // to expiry (10.0.0.1) must have been evicted rather than growing without bound —
  // a fresh bucket admits that address again.
  assert.equal(limiter(req('10.0.0.1')), true, 'eviction keeps the bucket map bounded under distributed traffic');
});

test('Pages now-playing misses are cached no longer than the polling interval', async () => {
  await withFetch(async () => { throw new Error('offline'); }, async () => {
    const request = new Request('https://site.example/api/nowplaying?url=https%3A%2F%2Fice.example.net%2Fmiss-ttl', {
      headers: { 'cf-connecting-ip': '10.7.7.7' }
    });
    const response = await nowPlayingGet({ request });
    const body = await response.json();
    assert.equal(body.found, false);
    // The renderer polls every 30 seconds; a longer miss max-age would hide upstream
    // recovery for an extra cycle behind the browser/edge cache.
    const maxAge = Number(response.headers.get('cache-control').match(/max-age=(\d+)/)?.[1]);
    assert.ok(maxAge <= 30, `miss max-age ${maxAge} must not exceed the 30s polling interval`);
  });
});
