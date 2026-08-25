// Regressions for the Node guarded request boundary: every redirect hop re-passes the
// public-target policy, hops and wall-clock time are bounded, and the fingerprint
// sampler rides the same guard.

import assert from 'node:assert/strict';
import test from 'node:test';
import { guardedRequest } from '../server/net-guard.mjs';
import { sampleStreamAudio } from '../server/fingerprint-providers.mjs';

function fakeTargetFor(url) {
  return { href: url, url: new URL(url), hostname: new URL(url).hostname, address: '203.0.113.10', family: 4 };
}

function makeResolver({ privateHosts = [] } = {}) {
  const resolved = [];
  return {
    resolved,
    resolveTarget: async url => {
      resolved.push(url);
      const host = new URL(url).hostname;
      if (privateHosts.includes(host) || host === 'localhost' || /^127\./.test(host)) {
        throw new Error('private stream IPs are blocked');
      }
      return fakeTargetFor(url);
    }
  };
}

test('guardedRequest follows a public redirect and revalidates every hop', async () => {
  const { resolved, resolveTarget } = makeResolver();
  const performed = [];
  const performRequest = async target => {
    performed.push(target.href);
    if (target.href === 'https://radio.example/stream') {
      return { statusCode: 302, headers: { location: 'https://cdn.example/live.mp3' }, body: Buffer.alloc(0), text: '' };
    }
    return { statusCode: 200, headers: { 'content-type': 'audio/mpeg' }, body: Buffer.from('audio'), text: 'audio' };
  };

  const response = await guardedRequest('https://radio.example/stream', { resolveTarget, performRequest });
  assert.equal(response.statusCode, 200);
  assert.equal(response.finalUrl, 'https://cdn.example/live.mp3');
  assert.equal(response.hops, 1);
  // Both hops were validated by the public-target policy before any request.
  assert.deepEqual(resolved, ['https://radio.example/stream', 'https://cdn.example/live.mp3']);
  assert.deepEqual(performed, ['https://radio.example/stream', 'https://cdn.example/live.mp3']);
});

test('guardedRequest rejects a redirect to a private target before requesting it', async () => {
  const { resolveTarget } = makeResolver();
  const performed = [];
  const performRequest = async target => {
    performed.push(target.href);
    return { statusCode: 302, headers: { location: 'http://127.0.0.1:8080/internal' }, body: Buffer.alloc(0), text: '' };
  };

  await assert.rejects(
    guardedRequest('https://radio.example/stream', { resolveTarget, performRequest }),
    /private/
  );
  // The private destination was never fetched.
  assert.deepEqual(performed, ['https://radio.example/stream']);
});

test('guardedRequest resolves relative redirects and detects loops', async () => {
  const { resolveTarget } = makeResolver();
  const relative = await guardedRequest('https://radio.example/a', {
    resolveTarget,
    performRequest: async target => target.href.endsWith('/a')
      ? { statusCode: 301, headers: { location: '/b' }, body: Buffer.alloc(0), text: '' }
      : { statusCode: 200, headers: {}, body: Buffer.from('ok'), text: 'ok' }
  });
  assert.equal(relative.finalUrl, 'https://radio.example/b');

  await assert.rejects(
    guardedRequest('https://radio.example/a', {
      resolveTarget: makeResolver().resolveTarget,
      performRequest: async target => ({
        statusCode: 302,
        headers: { location: target.href.endsWith('/a') ? 'https://radio.example/b' : 'https://radio.example/a' },
        body: Buffer.alloc(0),
        text: ''
      })
    }),
    /redirect loop/
  );
});

test('guardedRequest caps redirect hops', async () => {
  let counter = 0;
  await assert.rejects(
    guardedRequest('https://radio.example/0', {
      resolveTarget: makeResolver().resolveTarget,
      performRequest: async () => {
        counter += 1;
        return { statusCode: 302, headers: { location: `https://radio.example/${counter}` }, body: Buffer.alloc(0), text: '' };
      }
    }),
    /too many redirects/
  );
  assert.ok(counter <= 4);
});

test('the wall-clock deadline is enforced across hops regardless of per-hop progress', async () => {
  const { resolveTarget } = makeResolver();
  let hops = 0;
  await assert.rejects(
    guardedRequest('https://radio.example/slow', {
      resolveTarget,
      deadlineAt: Date.now() + 120,
      performRequest: async target => {
        hops += 1;
        await new Promise(resolve => setTimeout(resolve, 90));
        return { statusCode: 302, headers: { location: `${target.href}x` }, body: Buffer.alloc(0), text: '' };
      }
    }),
    /deadline/
  );
  assert.ok(hops <= 2, `deadline should stop the chain early, saw ${hops} hops`);
});

test('fingerprint sampling succeeds through a public redirect and rejects a private one', async () => {
  const audio = Buffer.alloc(200 * 1024, 7);
  const publicChain = makeResolver();
  const requestImpl = (url, options) => guardedRequest(url, {
    ...options,
    resolveTarget: publicChain.resolveTarget,
    performRequest: async target => target.href === 'https://radio.example/stream'
      ? { statusCode: 302, headers: { location: 'https://cdn.example/live.mp3' }, body: Buffer.alloc(0), text: '' }
      : { statusCode: 200, headers: { 'content-type': 'audio/mpeg', 'icy-br': '128' }, body: audio, text: '' }
  });
  const sample = await sampleStreamAudio('https://radio.example/stream', {
    requestImpl,
    resolveTarget: publicChain.resolveTarget
  });
  assert.equal(sample.body.length, audio.length);
  assert.equal(sample.contentType, 'audio/mpeg');

  const privateChain = makeResolver();
  await assert.rejects(
    sampleStreamAudio('https://radio.example/stream', {
      resolveTarget: privateChain.resolveTarget,
      requestImpl: (url, options) => guardedRequest(url, {
        ...options,
        resolveTarget: privateChain.resolveTarget,
        performRequest: async () => ({ statusCode: 302, headers: { location: 'http://127.0.0.1/loop.mp3' }, body: Buffer.alloc(0), text: '' })
      })
    }),
    /private/
  );
});

// --- Second-review regressions: cache TTL, fMP4 init segments, provider outages ---

import { CACHE_TTL_HIT_MS, clearFingerprintCache, identifyByFingerprint } from '../server/fingerprint-providers.mjs';

test('positive fingerprint cache entries expire within the client retry cooldown', () => {
  assert.ok(CACHE_TTL_HIT_MS <= 30_000, `hit TTL ${CACHE_TTL_HIT_MS}ms must not exceed the 30s client cooldown`);
});

test('an all-provider outage reports an error, not a negative identification', async () => {
  clearFingerprintCache();
  const env = { AUDD_API_TOKEN: 'token' };
  const sampleImpl = async () => ({ body: Buffer.alloc(64 * 1024, 1), contentType: 'audio/mpeg' });
  const outage = await identifyByFingerprint({
    streamUrl: 'https://ice.example.net/outage',
    env,
    sampleImpl,
    recognizeImpl: async () => { throw new Error('audd request failed'); }
  });
  assert.equal(outage.found, false);
  assert.equal(outage.providerError, true);
  assert.match(outage.reason, /unavailable/);

  clearFingerprintCache();
  const miss = await identifyByFingerprint({
    streamUrl: 'https://ice.example.net/quiet',
    env,
    sampleImpl,
    recognizeImpl: async () => null
  });
  assert.equal(miss.found, false);
  assert.equal(miss.providerError, undefined);
  assert.equal(miss.reason, 'no fingerprint match');
  clearFingerprintCache();
});

test('fMP4 HLS sampling prepends the EXT-X-MAP initialization segment', async () => {
  const initBytes = Buffer.from('INIT-SEGMENT----' + 'i'.repeat(16 * 1024));
  const mediaBytes = Buffer.from('MEDIA-SEGMENT---' + 'm'.repeat(16 * 1024));
  const { resolveTarget } = makeResolver();
  const requestImpl = async url => {
    if (url.endsWith('/live.m3u8')) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        body: Buffer.from(''),
        text: '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nseg1.m4s\n#EXTINF:4,\nseg2.m4s\n',
        finalUrl: url
      };
    }
    if (url.endsWith('/init.mp4')) return { statusCode: 200, headers: {}, body: initBytes, text: '', finalUrl: url };
    return { statusCode: 200, headers: {}, body: mediaBytes, text: '', finalUrl: url };
  };
  const sample = await sampleStreamAudio('https://hls.example/live.m3u8', { requestImpl, resolveTarget });
  assert.ok(sample.body.subarray(0, 12).toString().startsWith('INIT-SEGMENT'), 'sample must begin with the initialization segment');
  assert.ok(sample.body.length > initBytes.length);
});

test('extensionless HLS media playlists are parsed as playlists, not nested children', async () => {
  const segment = Buffer.from('SEGDATA-'.repeat(4 * 1024));
  const { resolveTarget } = makeResolver();
  const fetched = [];
  const requestImpl = async url => {
    fetched.push(url);
    if (url === 'https://radio.example/stream') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        body: Buffer.from(''),
        // A media playlist (no #EXT-X-STREAM-INF): its first URI is a segment, and must
        // never be re-fetched and parsed as another playlist.
        text: '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg1.aac\n#EXTINF:4,\nseg2.aac\n',
        finalUrl: url
      };
    }
    return { statusCode: 200, headers: {}, body: segment, text: '', finalUrl: url };
  };
  const sample = await sampleStreamAudio('https://radio.example/stream', { requestImpl, resolveTarget });
  assert.ok(fetched.includes('https://radio.example/seg1.aac'), `segments fetched directly, saw ${fetched.join(', ')}`);
  assert.ok(fetched.includes('https://radio.example/seg2.aac'));
  assert.ok(sample.body.length >= segment.length * 2, 'both media segments are concatenated');
});
