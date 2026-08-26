// Regressions for the Node guarded request boundary: every redirect hop re-passes the
// public-target policy, hops and wall-clock time are bounded, and the fingerprint
// sampler rides the same guard.

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { guardedRequest, isPrivateIp, requestLimited, requestPublic, resolvePublicTarget } from '../server/net-guard.mjs';
import { isPublicIpAddress } from '../server/public-ip-policy.mjs';
import { sampleHlsAudio, sampleStreamAudio } from '../server/fingerprint-providers.mjs';
import { deniedIpv6Vectors, publicIpv6Controls } from './fixtures/public-ip-policy-vectors.mjs';

function fakeTargetFor(url) {
  return { href: url, url: new URL(url), hostname: new URL(url).hostname, address: '1.1.1.1', family: 4 };
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

test('requestPublic follows a public redirect and reports the final destination', async () => {
  const calls = [];
  const responses = new Map([
    ['https://radio.example/start', { statusCode: 302, headers: { location: '/audio' }, body: Buffer.alloc(0) }],
    ['https://radio.example/audio', { statusCode: 200, headers: { 'content-type': 'audio/mpeg' }, body: Buffer.from('audio') }]
  ]);
  const result = await requestPublic('https://radio.example/start', {
    resolveTarget: async href => fakeTargetFor(href),
    requestOnce: async target => {
      calls.push(target.href);
      return responses.get(target.href);
    }
  });
  assert.deepEqual(calls, ['https://radio.example/start', 'https://radio.example/audio']);
  assert.equal(result.finalUrl, 'https://radio.example/audio');
});

test('public target policy rejects credentials and reserved address ranges', async () => {
  await assert.rejects(resolvePublicTarget('https://user:pass@1.1.1.1/live'), /credentials/);
  for (const address of ['192.0.2.1', '198.51.100.7', '203.0.113.9', '198.18.0.1', '2001:db8::1', 'fec0::1']) {
    assert.equal(isPrivateIp(address), true, `${address} must fail closed`);
  }
  assert.equal(isPrivateIp('192.0.1.1'), false, 'only 192.0.0.0/24 is reserved by this rule');
});

test('requestPublic bounds DNS resolution on the initial and redirect hops', async () => {
  const forever = new Promise(() => {});
  const initialStarted = Date.now();
  await assert.rejects(
    requestPublic('https://radio.example/slow-dns', { deadlineAt: initialStarted + 60, resolveTarget: async () => forever }),
    /request timeout/
  );
  assert.ok(Date.now() - initialStarted < 300);

  let resolutions = 0;
  await assert.rejects(
    requestPublic('https://radio.example/start', {
      deadlineAt: Date.now() + 60,
      resolveTarget: async href => {
        resolutions += 1;
        return resolutions === 1 ? fakeTargetFor(href) : forever;
      },
      requestOnce: async () => ({ statusCode: 302, headers: { location: '/slow-dns' }, body: Buffer.alloc(0) })
    }),
    /request timeout/
  );
  assert.equal(resolutions, 2);
});

test('requestLimited rejects a trickling response when its absolute deadline expires', async t => {
  const server = http.createServer((_req, response) => {
    response.writeHead(200, { 'content-type': 'audio/mpeg' });
    const interval = setInterval(() => response.write('x'), 15);
    response.on('close', () => clearInterval(interval));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const target = fakeTargetFor(`http://127.0.0.1:${port}/trickle`);
  target.address = '127.0.0.1';
  const started = Date.now();
  await assert.rejects(requestLimited(target, { deadlineAt: started + 120 }), /request timeout/);
  assert.ok(Date.now() - started < 500);
});

test('requestLimited closes a redirect response body before resolving', async t => {
  let activeResponse;
  let writes = 0;
  let resolveClosed;
  const peerClosed = new Promise(resolve => { resolveClosed = resolve; });
  const server = http.createServer((_request, response) => {
    activeResponse = response;
    response.writeHead(302, { location: '/next' });
    response.flushHeaders();
    const interval = setInterval(() => {
      writes += 1;
      response.write(Buffer.alloc(1024));
    }, 10);
    response.on('close', () => {
      clearInterval(interval);
      resolveClosed();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    activeResponse?.destroy();
    await new Promise(resolve => server.close(resolve));
  });

  const { port } = server.address();
  const target = fakeTargetFor(`http://127.0.0.1:${port}/redirect`);
  target.address = '127.0.0.1';
  const result = await requestLimited(target, { deadlineAt: Date.now() + 200 });
  assert.equal(result.statusCode, 302);
  const closedBeforeDeadline = await Promise.race([
    peerClosed.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 100))
  ]);
  assert.equal(closedBeforeDeadline, true, `redirect body remained live after settlement (${writes} peer writes)`);
});

test('requestLimited aborts the active response and peer when its caller is gone', async t => {
  let activeResponse;
  let resolveClosed;
  const peerClosed = new Promise(resolve => { resolveClosed = resolve; });
  const server = http.createServer((_request, response) => {
    activeResponse = response;
    response.writeHead(200, { 'content-type': 'audio/mpeg' });
    const interval = setInterval(() => response.write('x'), 10);
    response.on('close', () => {
      clearInterval(interval);
      resolveClosed();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    activeResponse?.destroy();
    await new Promise(resolve => server.close(resolve));
  });

  const { port } = server.address();
  const target = fakeTargetFor(`http://127.0.0.1:${port}/abort`);
  target.address = '127.0.0.1';
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  const startedAt = Date.now();
  await assert.rejects(
    requestLimited(target, { deadlineAt: startedAt + 1000, signal: controller.signal }),
    /request aborted/
  );
  await peerClosed;
  assert.ok(Date.now() - startedAt < 250, 'caller abort left the outbound response alive');
});

test('requestLimited keeps byte and stopWhen partial reads successful', async t => {
  const server = http.createServer((_req, response) => response.end('abcdef'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const target = fakeTargetFor(`http://127.0.0.1:${port}/partial`);
  target.address = '127.0.0.1';
  const byteCapped = await requestLimited(target, { deadlineAt: Date.now() + 1_000, maxBytes: 3 });
  assert.equal(byteCapped.text, 'abc');
  assert.equal(byteCapped.truncated, true);
  const stopped = await requestLimited(target, { deadlineAt: Date.now() + 1_000, stopWhen: ({ length }) => length >= 2 });
  assert.equal(stopped.text, 'abcdef');
  assert.equal(stopped.truncated, true);
});

test('requestLimited supplies one default user agent and preserves a case-insensitive override', async t => {
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push(request.headers['user-agent']);
    response.end('ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const target = fakeTargetFor(`http://127.0.0.1:${port}/headers`);
  target.address = '127.0.0.1';
  await requestLimited(target, { deadlineAt: Date.now() + 1_000 });
  await requestLimited(target, { deadlineAt: Date.now() + 1_000, headers: { 'user-agent': 'Test radio client' } });
  assert.deepEqual(seen, [
    'EarthRadio/0.24.0 (+https://github.com/Protonmatter/EarthRadio)',
    'Test radio client'
  ]);
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

test('requestPublic rejects an IPv6 loopback redirect before the second request', async () => {
  let requests = 0;
  await assert.rejects(
    requestPublic('https://radio.example/stream', {
      resolveTarget: async href => href.includes('[::1]') ? resolvePublicTarget(href) : fakeTargetFor(href),
      requestOnce: async () => {
        requests += 1;
        return { statusCode: 302, headers: { location: 'http://[::1]/admin' }, body: Buffer.alloc(0), text: '' };
      }
    }),
    /private/
  );
  assert.equal(requests, 1);
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
    /redirect limit exceeded/
  );
  assert.ok(counter <= 5);
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
    /request timeout/
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

test('HLS playlist redirects use their final public URL as the base for media segments', async () => {
  const requested = [];
  const resolveTarget = async href => fakeTargetFor(href);
  const requestImpl = (href, options) => requestPublic(href, {
    ...options,
    resolveTarget,
    requestOnce: async target => {
      requested.push(target.href);
      if (target.href === 'https://radio.example/live.m3u8') {
        return { statusCode: 302, headers: { location: 'https://cdn.example/hls/live.m3u8' }, body: Buffer.alloc(0), text: '' };
      }
      if (target.href === 'https://cdn.example/hls/live.m3u8') {
        return { statusCode: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' }, body: Buffer.from('#EXTM3U\nchunk.aac\n'), text: '#EXTM3U\nchunk.aac\n' };
      }
      return { statusCode: 200, headers: { 'content-type': 'audio/aac' }, body: Buffer.from('audio'), text: 'audio' };
    }
  });
  const sample = await sampleStreamAudio('https://radio.example/live.m3u8', { requestImpl });
  assert.equal(sample.body.toString(), 'audio');
  assert.deepEqual(requested, [
    'https://radio.example/live.m3u8',
    'https://cdn.example/hls/live.m3u8',
    'https://cdn.example/hls/chunk.aac'
  ]);
});

test('sequential HLS playlist and segment reads share one absolute deadline', async () => {
  const requested = [];
  const requestImpl = (href, options) => requestPublic(href, {
    ...options,
    resolveTarget: async url => fakeTargetFor(url),
    requestOnce: async target => {
      requested.push(target.href);
      // Fast first reads leave the third read ~500ms of scheduler headroom to
      // start inside the deadline; the third read then sleeps far PAST the
      // deadline so the shared-deadline rejection can never race its resolution
      // (an equal-sleep version of this test tied at exactly the deadline and
      // flipped outcomes between runners).
      await new Promise(resolve => setTimeout(resolve, target.href.endsWith('/two.aac') ? 1500 : 50));
      if (target.href.endsWith('/live.m3u8')) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/vnd.apple.mpegurl' },
          body: Buffer.from('#EXTM3U\none.aac\ntwo.aac\n'),
          text: '#EXTM3U\none.aac\ntwo.aac\n'
        };
      }
      return { statusCode: 200, headers: { 'content-type': 'audio/aac' }, body: Buffer.from('audio'), text: 'audio' };
    }
  });
  // The third read must still start — proving the deadline is not reset per
  // read — and then cross the shared deadline mid-body.
  await assert.rejects(
    sampleHlsAudio('https://radio.example/live.m3u8', { seconds: 5, deadlineAt: Date.now() + 600, requestImpl }),
    /request timeout/
  );
  assert.deepEqual(requested, [
    'https://radio.example/live.m3u8',
    'https://radio.example/one.aac',
    'https://radio.example/two.aac'
  ]);
});

test('the exported HLS helper uses the public request boundary by default', async () => {
  await assert.rejects(
    sampleHlsAudio('http://127.0.0.1/live.m3u8', { seconds: 5, deadlineAt: Date.now() + 100 }),
    /private stream IPs are blocked/
  );
});

test('shared IPv6 policy rejects stable non-global forms and preserves public controls', async () => {
  for (const address of deniedIpv6Vectors) {
    assert.equal(isPrivateIp(address), true, `${address} must be rejected`);
    assert.equal(isPublicIpAddress(address), false, `${address} must fail at the shared pure boundary`);
    await assert.rejects(resolvePublicTarget(`http://[${address}]/live`), /private/, `${address} must fail at the Node URL boundary`);
  }
  for (const address of publicIpv6Controls) {
    assert.equal(isPrivateIp(address), false, `${address} must remain public`);
    assert.equal(isPublicIpAddress(address), true, `${address} must pass at the shared pure boundary`);
    assert.equal((await resolvePublicTarget(`http://[${address}]/live`)).family, 6, `${address} must pass at the Node URL boundary`);
  }
  assert.equal(isPublicIpAddress('2620:4F:8000:0:0:0:0:1'), true, 'case and expansion preserve a public GUA');
  assert.equal(isPublicIpAddress('0:0:0:0:0:FFFF:7F00:0001'), false, 'expanded mapped private forms fail closed');
  assert.equal(isPrivateIp('2606:4700:4700::1111%eth0'), true, 'scoped literals must fail closed');
});

test('requestPublic rejects a special-purpose IPv6 redirect before the second sink call', async () => {
  let requests = 0;
  await assert.rejects(
    requestPublic('https://radio.example/live', {
      resolveTarget: href => href.includes('[100::1]') ? resolvePublicTarget(href) : fakeTargetFor(href),
      requestOnce: async () => {
        requests += 1;
        return { statusCode: 302, headers: { location: 'http://[100::1]/admin' }, body: Buffer.alloc(0), text: '' };
      }
    }),
    /private/
  );
  assert.equal(requests, 1);
});

test('requestPublic rejects a legacy translated private IPv6 redirect before the second sink call', async () => {
  let requests = 0;
  await assert.rejects(
    requestPublic('https://radio.example/live', {
      resolveTarget: href => href.includes('radio.example') ? fakeTargetFor(href) : resolvePublicTarget(href),
      requestOnce: async () => {
        requests += 1;
        return requests === 1
          ? { statusCode: 302, headers: { location: 'http://[::ffff:0:127.0.0.1]/admin' }, body: Buffer.alloc(0), text: '' }
          : { statusCode: 200, headers: {}, body: Buffer.from('internal'), text: 'internal' };
      }
    }),
    /private/
  );
  assert.equal(requests, 1);
});

test('Node HLS rejects translated private init and segment URLs before their sink', async () => {
  const outcomes = [];
  for (const stage of ['init', 'segment']) {
    const calls = [];
    const playlistUrl = `https://8.8.8.8/${stage}.m3u8`;
    const translatedUrl = `http://[::ffff:0:127.0.0.1]/${stage}.mp4`;
    const playlist = stage === 'init'
      ? `#EXTM3U\n#EXT-X-MAP:URI="${translatedUrl}"\n#EXTINF:4,\nhttps://8.8.4.4/segment.m4s\n`
      : `#EXTM3U\n#EXTINF:4,\n${translatedUrl}\n`;
    const requestImpl = (url, options = {}) => requestPublic(url, {
      ...options,
      resolveTarget: resolvePublicTarget,
      requestOnce: async target => {
        calls.push(target.href);
        if (target.href === playlistUrl) {
          return {
            statusCode: 200,
            headers: { 'content-type': 'application/vnd.apple.mpegurl' },
            body: Buffer.from(playlist),
            text: playlist
          };
        }
        return { statusCode: 200, headers: { 'content-type': 'video/mp4' }, body: Buffer.from('audio'), text: 'audio' };
      }
    });
    let error;
    try {
      await sampleHlsAudio(playlistUrl, { seconds: 5, deadlineAt: Date.now() + 1000, requestImpl });
    } catch (caught) {
      error = caught;
    }
    outcomes.push({ stage, calls, error });
  }

  for (const outcome of outcomes) {
    assert.match(outcome.error?.message || '', /private/, outcome.stage);
    assert.deepEqual(outcome.calls, [`https://8.8.8.8/${outcome.stage}.m3u8`], outcome.stage);
  }
});

test('Node HLS preserves a legacy translated IPv6 init with a public IPv4 suffix', async () => {
  const calls = [];
  const playlistUrl = 'https://8.8.8.8/public-translated.m3u8';
  const playlist = '#EXTM3U\n#EXT-X-MAP:URI="http://[::ffff:0:8.8.8.8]/init.mp4"\n#EXTINF:4,\nhttps://8.8.4.4/segment.m4s\n';
  const requestImpl = (url, options = {}) => requestPublic(url, {
    ...options,
    resolveTarget: resolvePublicTarget,
    requestOnce: async target => {
      calls.push(target.href);
      if (target.href === playlistUrl) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/vnd.apple.mpegurl' },
          body: Buffer.from(playlist),
          text: playlist
        };
      }
      return { statusCode: 200, headers: { 'content-type': 'video/mp4' }, body: Buffer.from('audio'), text: 'audio' };
    }
  });

  const sample = await sampleHlsAudio(playlistUrl, { seconds: 5, deadlineAt: Date.now() + 1000, requestImpl });
  assert.equal(sample.body.toString(), 'audioaudio');
  assert.deepEqual(calls, [
    playlistUrl,
    'http://[::ffff:0:808:808]/init.mp4',
    'https://8.8.4.4/segment.m4s'
  ]);
});

test('content-type-only HLS media playlists reuse the body already fetched', async () => {
  const requested = [];
  const requestImpl = async url => {
    requested.push(url);
    if (url === 'https://hls.example/live') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        body: Buffer.from('#EXTM3U\n#EXTINF:4,\nseg-1.aac\n#EXTINF:4,\nseg-2.aac\n'),
        text: '#EXTM3U\n#EXTINF:4,\nseg-1.aac\n#EXTINF:4,\nseg-2.aac\n',
        finalUrl: url
      };
    }
    if (url.endsWith('/seg-1.aac')) return { statusCode: 200, headers: { 'content-type': 'audio/aac' }, body: Buffer.from('one'), text: 'binary audio bytes', finalUrl: url };
    if (url.endsWith('/seg-2.aac')) return { statusCode: 200, headers: { 'content-type': 'audio/aac' }, body: Buffer.from('two'), text: 'binary audio bytes', finalUrl: url };
    throw new Error(`unexpected request ${url}`);
  };

  const sample = await sampleStreamAudio('https://hls.example/live', { requestImpl });
  assert.equal(sample.body.toString(), 'onetwo');
  assert.deepEqual(requested, [
    'https://hls.example/live',
    'https://hls.example/seg-1.aac',
    'https://hls.example/seg-2.aac'
  ]);
});

test('content-type-only HLS master playlists reuse the body and follow the variant', async () => {
  const requested = [];
  const requestImpl = async url => {
    requested.push(url);
    if (url === 'https://hls.example/live') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        body: Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nmedia.m3u8\n'),
        text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nmedia.m3u8\n',
        finalUrl: url
      };
    }
    if (url.endsWith('/media.m3u8')) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        body: Buffer.from('#EXTM3U\n#EXTINF:4,\nsegment.aac\n'),
        text: '#EXTM3U\n#EXTINF:4,\nsegment.aac\n',
        finalUrl: url
      };
    }
    return { statusCode: 200, headers: { 'content-type': 'audio/aac' }, body: Buffer.from('audio'), text: 'audio', finalUrl: url };
  };

  const sample = await sampleStreamAudio('https://hls.example/live', { requestImpl });
  assert.equal(sample.body.toString(), 'audio');
  assert.deepEqual(requested, [
    'https://hls.example/live',
    'https://hls.example/media.m3u8',
    'https://hls.example/segment.aac'
  ]);
});

test('Node HLS sampling keeps only the coherent map-governed tail', async () => {
  const requested = [];
  const requestImpl = async url => {
    requested.push(url);
    if (url.endsWith('/live.m3u8')) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        body: Buffer.alloc(0),
        text: '#EXTM3U\n#EXT-X-MAP:URI="init-a.mp4"\n#EXTINF:4,\nold-1.m4s\n#EXT-X-MAP:URI="init-b.mp4"\n#EXTINF:4,\nnew-1.m4s\n#EXTINF:4,\nnew-2.m4s\n',
        finalUrl: url
      };
    }
    return { statusCode: 200, headers: { 'content-type': 'video/mp4' }, body: Buffer.from(url), text: '', finalUrl: url };
  };

  await sampleHlsAudio('https://hls.example/live.m3u8', { seconds: 5, requestImpl });
  assert.deepEqual(requested, [
    'https://hls.example/live.m3u8',
    'https://hls.example/init-b.mp4',
    'https://hls.example/new-1.m4s',
    'https://hls.example/new-2.m4s'
  ]);
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

test('byte-ranged HLS playlists fetch their exact fragments with Range headers', async () => {
  const calls = [];
  const { resolveTarget } = makeResolver();
  const requestImpl = async (url, options = {}) => {
    calls.push({ url, range: options.headers?.Range || '' });
    if (url.endsWith('/live.m3u8')) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        body: Buffer.from(''),
        text: [
          '#EXTM3U',
          '#EXT-X-MAP:URI="media.mp4",BYTERANGE="500@0"',
          '#EXT-X-BYTERANGE:1000@500',
          'media.mp4',
          // Offset-less continuation: starts where the previous sub-range ended.
          '#EXT-X-BYTERANGE:1000',
          'media.mp4',
          '#EXT-X-ENDLIST'
        ].join('\n'),
        finalUrl: url
      };
    }
    return { statusCode: 206, headers: {}, body: Buffer.from('f'.repeat(64)), text: '', finalUrl: url };
  };
  const sample = await sampleStreamAudio('https://hls.example/live.m3u8', { requestImpl, resolveTarget });
  assert.ok(sample.body.length > 0);
  const ranges = calls.filter(call => call.url.endsWith('/media.mp4')).map(call => call.range);
  assert.deepEqual(ranges, ['bytes=0-499', 'bytes=500-1499', 'bytes=1500-2499']);
});

test('encrypted HLS playlists are rejected before any segment fetch', async () => {
  let segmentFetches = 0;
  const { resolveTarget } = makeResolver();
  const requestImpl = async url => {
    if (url.endsWith('/live.m3u8')) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        body: Buffer.from(''),
        text: '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nseg2.ts\n',
        finalUrl: url
      };
    }
    segmentFetches += 1;
    return { statusCode: 200, headers: {}, body: Buffer.from('ciphertext'), text: '', finalUrl: url };
  };
  await assert.rejects(
    sampleStreamAudio('https://hls.example/live.m3u8', { requestImpl, resolveTarget }),
    /encrypted/i
  );
  assert.equal(segmentFetches, 0, 'ciphertext must never be fetched or submitted to recognizers');
});

test('a failed HLS initialization segment fetch is terminal', async () => {
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
    if (url.endsWith('/init.mp4')) return { statusCode: 404, headers: {}, body: Buffer.from(''), text: '', finalUrl: url };
    return { statusCode: 200, headers: {}, body: Buffer.from('m'.repeat(64)), text: '', finalUrl: url };
  };
  // Fragments without their EXT-X-MAP metadata are undecodable: the sampler must
  // fail rather than submit them and spend recognition quota on a predictable miss.
  await assert.rejects(
    sampleStreamAudio('https://hls.example/live.m3u8', { requestImpl, resolveTarget }),
    /initialization segment/i
  );
});
