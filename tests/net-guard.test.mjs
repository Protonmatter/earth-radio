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
