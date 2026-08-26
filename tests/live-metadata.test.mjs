import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { subscribeIcyTitles } from '../server/desktop-proxy.mjs';
import {
  clearPlatformNowPlayingCache,
  detectPlatformEndpoints,
  parsePlatformPayload,
  resolvePlatformNowPlaying
} from '../server/platform-nowplaying.mjs';
import {
  buildAcrSignature,
  clearFingerprintCache,
  fingerprintAvailable,
  fingerprintProviders,
  identifyByFingerprint,
  normalizeAcrResult,
  normalizeAuddResult
} from '../server/fingerprint-providers.mjs';

test('platform detection derives endpoints from known hosting platforms', () => {
  const zeno = detectPlatformEndpoints('https://stream.zeno.fm/abc123xyz');
  assert.equal(zeno[0].platform, 'zeno');
  assert.equal(zeno[0].url, 'https://api.zeno.fm/mounts/metadata/subscribe/abc123xyz');

  const radioco = detectPlatformEndpoints('https://streams.radio.co/s0aa1e6f4a/listen');
  assert.equal(radioco[0].platform, 'radioco');
  assert.equal(radioco[0].url, 'https://public.radio.co/stations/s0aa1e6f4a/status');

  const laut = detectPlatformEndpoints('https://stream.laut.fm/jahfari');
  assert.equal(laut[0].platform, 'lautfm');
  assert.equal(laut[0].url, 'https://api.laut.fm/station/jahfari/current_song');

  const radiojar = detectPlatformEndpoints('https://stream.radiojar.com/whkr3ayd9nhvv');
  assert.equal(radiojar[0].platform, 'radiojar');
  assert.equal(radiojar[0].url, 'https://www.radiojar.com/api/stations/whkr3ayd9nhvv/now_playing/');

  const azuracast = detectPlatformEndpoints('https://radio.example.org/listen/my_station/radio.mp3');
  assert.equal(azuracast[0].platform, 'azuracast');
  assert.equal(azuracast[0].url, 'https://radio.example.org/api/nowplaying/my_station');
});

test('platform detection always falls back to icecast and shoutcast status on the stream origin', () => {
  const endpoints = detectPlatformEndpoints('https://ice.example.net:8443/mount.aac');
  const platforms = endpoints.map(endpoint => endpoint.platform);
  assert.deepEqual(platforms, ['icecast', 'shoutcast']);
  assert.equal(endpoints[0].url, 'https://ice.example.net:8443/status-json.xsl');
  assert.equal(endpoints[0].mount, '/mount.aac');
  assert.equal(endpoints[1].url, 'https://ice.example.net:8443/stats?json=1');
});

test('platform detection rejects invalid and non-http URLs', () => {
  assert.deepEqual(detectPlatformEndpoints('not a url'), []);
  assert.deepEqual(detectPlatformEndpoints('ftp://example.org/stream'), []);
  assert.deepEqual(detectPlatformEndpoints(''), []);
});

test('azuracast payloads resolve structured artist and title', () => {
  const result = parsePlatformPayload({ platform: 'azuracast', kind: 'json' }, JSON.stringify({
    now_playing: { song: { artist: 'IU', title: 'Blueming', text: 'IU - Blueming', art: 'https://cdn.example.org/art.jpg' } }
  }));
  assert.equal(result.artist, 'IU');
  assert.equal(result.title, 'Blueming');
  assert.equal(result.artworkUrl, 'https://cdn.example.org/art.jpg');
});

test('combined-title platforms reuse the ICY parser and reject junk', () => {
  const hit = parsePlatformPayload({ platform: 'radioco', kind: 'json' }, JSON.stringify({
    current_track: { title: 'Kate Bush - Running Up That Hill' }
  }));
  assert.equal(hit.artist, 'Kate Bush');
  assert.equal(hit.title, 'Running Up That Hill');

  const junk = parsePlatformPayload({ platform: 'shoutcast', kind: 'json' }, JSON.stringify({ songtitle: 'Advertisement' }));
  assert.equal(junk, null);
});

test('icecast payloads match the requested mount before trusting titles', () => {
  const payload = JSON.stringify({
    icestats: {
      source: [
        { listenurl: 'http://ice.example.net:8000/other', artist: 'Wrong', title: 'Song' },
        { listenurl: 'http://ice.example.net:8000/mount.aac', artist: 'BTS', title: 'Dynamite' }
      ]
    }
  });
  const result = parsePlatformPayload({ platform: 'icecast', kind: 'json', mount: '/mount.aac' }, payload);
  assert.equal(result.artist, 'BTS');
  assert.equal(result.title, 'Dynamite');
});

test('zeno SSE frames resolve the first streamTitle event', () => {
  const frame = 'event: message\ndata: {"streamTitle":"NewJeans - Super Shy"}\n\n';
  const result = parsePlatformPayload({ platform: 'zeno', kind: 'sse' }, frame);
  assert.equal(result.artist, 'NewJeans');
  assert.equal(result.title, 'Super Shy');
});

test('resolvePlatformNowPlaying walks candidates, reports attempts, and caches hits', async () => {
  clearPlatformNowPlayingCache();
  const calls = [];
  const fetchTextImpl = async endpoint => {
    calls.push(endpoint.platform);
    if (endpoint.platform === 'shoutcast') return JSON.stringify({ songtitle: 'Aespa - Supernova' });
    return '';
  };
  const first = await resolvePlatformNowPlaying('https://ice.example.net/mount', { fetchTextImpl });
  assert.equal(first.found, true);
  assert.equal(first.platform, 'shoutcast');
  assert.equal(first.artist, 'Aespa');
  assert.deepEqual(first.attempted, ['icecast', 'shoutcast']);

  const second = await resolvePlatformNowPlaying('https://ice.example.net/mount', { fetchTextImpl });
  assert.equal(second.cached, true);
  assert.deepEqual(calls, ['icecast', 'shoutcast']);
  clearPlatformNowPlayingCache();
});

test('desktop generic probes run concurrently inside one absolute resolution deadline', async () => {
  clearPlatformNowPlayingCache();
  let active = 0;
  let peak = 0;
  let settled = 0;
  const deadlines = [];
  const startedAt = Date.now();
  const fetchTextImpl = async (endpoint, options) => {
    deadlines.push(options?.deadlineAt ?? options);
    active += 1;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 80));
      return endpoint.platform === 'shoutcast'
        ? JSON.stringify({ songtitle: 'Aespa - Supernova' })
        : '';
    } finally {
      active -= 1;
      settled += 1;
    }
  };

  const result = await resolvePlatformNowPlaying('https://ice.example.net/concurrent', {
    timeoutMs: 110,
    fetchTextImpl
  });
  const elapsed = Date.now() - startedAt;
  assert.equal(result.found, true);
  assert.equal(result.platform, 'shoutcast');
  assert.equal(peak, 2, 'independent Icecast and Shoutcast probes were serialized');
  assert.equal(active, 0, 'a generic probe remained live after resolution');
  assert.equal(settled, 2);
  assert.ok(elapsed < 140, `one 110ms operation budget took ${elapsed}ms`);
  assert.equal(new Set(deadlines).size, 1, 'generic probes did not share one deadline');
  assert.ok(deadlines[0] >= startedAt + 90, 'the injected boundary received a relative timeout instead of an absolute deadline');
  clearPlatformNowPlayingCache();
});

test('platform misses and transport failures retry after one polling interval', async () => {
  const realNow = Date.now;
  let clock = 2_000_000;
  Date.now = () => clock;
  try {
    for (const mode of ['miss', 'transport']) {
      clearPlatformNowPlayingCache();
      let calls = 0;
      const fetchTextImpl = async () => {
        calls += 1;
        if (mode === 'transport') throw new Error('temporary transport failure');
        return '';
      };
      const stream = `https://ice.example.net/${mode}`;
      const first = await resolvePlatformNowPlaying(stream, { fetchTextImpl });
      assert.equal(first.found, false);
      await resolvePlatformNowPlaying(stream, { fetchTextImpl });
      assert.equal(calls, 2, `${mode} was not cached inside one poll interval`);
      clock += 31_000;
      await resolvePlatformNowPlaying(stream, { fetchTextImpl });
      assert.equal(calls, 4, `${mode} remained hidden beyond one 30s poll interval`);
      clock += 1_000_000;
    }
  } finally {
    Date.now = realNow;
    clearPlatformNowPlayingCache();
  }
});

test('fingerprint availability requires provider credentials', () => {
  assert.equal(fingerprintAvailable({}), false);
  assert.deepEqual(fingerprintProviders({}), []);
  assert.deepEqual(fingerprintProviders({ AUDD_API_TOKEN: 't' }), ['audd']);
  assert.deepEqual(
    fingerprintProviders({ ACR_HOST: 'identify-eu-west-1.acrcloud.com', ACR_ACCESS_KEY: 'k', ACR_ACCESS_SECRET: 's' }),
    ['acrcloud']
  );
  assert.equal(fingerprintProviders({ ACR_HOST: 'h', ACR_ACCESS_KEY: 'k' }).length, 0);
});

test('ACR identify signature is deterministic', () => {
  const signature = buildAcrSignature({ accessKey: 'key', accessSecret: 'secret', timestamp: 1700000000 });
  assert.equal(signature, 'tWbqxXkbyadGeaHIJS/OzfF+KdU=');
});

test('ACR responses normalize into the shared fingerprint identity shape', () => {
  const result = normalizeAcrResult({
    status: { code: 0 },
    metadata: {
      music: [{
        title: 'Running Up That Hill',
        artists: [{ name: 'Kate Bush' }],
        album: { name: 'Hounds of Love' },
        release_date: '1985-09-16',
        score: 92,
        external_ids: { isrc: 'GBAAA8500001' },
        external_metadata: { spotify: { track: { id: '75FEaRjZTKLhTrFGsfMUXR' } } }
      }]
    }
  });
  assert.equal(result.provider, 'acrcloud');
  assert.equal(result.artist, 'Kate Bush');
  assert.equal(result.releaseYear, '1985');
  assert.equal(result.isrc, 'GBAAA8500001');
  assert.equal(result.spotifyUrl, 'https://open.spotify.com/track/75FEaRjZTKLhTrFGsfMUXR');
  assert.equal(normalizeAcrResult({ status: { code: 1001 } }), null);
});

test('AudD responses normalize into the shared fingerprint identity shape', () => {
  const result = normalizeAuddResult({
    status: 'success',
    result: {
      artist: 'Kate Bush',
      title: 'Running Up That Hill',
      album: 'Hounds of Love',
      release_date: '1985-09-16',
      spotify: { external_urls: { spotify: 'https://open.spotify.com/track/x' }, external_ids: { isrc: 'GBAAA8500001' } }
    }
  });
  assert.equal(result.provider, 'audd');
  assert.equal(result.title, 'Running Up That Hill');
  assert.equal(result.isrc, 'GBAAA8500001');
  assert.equal(normalizeAuddResult({ status: 'success', result: null }), null);
  assert.equal(normalizeAuddResult({ status: 'error' }), null);
});

test('identifyByFingerprint short-circuits without credentials and caches results with them', async () => {
  clearFingerprintCache();
  const unavailable = await identifyByFingerprint({ streamUrl: 'https://ice.example.net/mount', env: {} });
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.found, false);

  let samples = 0;
  const env = { AUDD_API_TOKEN: 'token' };
  const sampleImpl = async () => {
    samples += 1;
    return { body: Buffer.alloc(64 * 1024, 1), contentType: 'audio/mpeg' };
  };
  const recognizeImpl = async provider => {
    assert.equal(provider, 'audd');
    return { provider: 'audd', artist: 'IU', title: 'Blueming', album: '', releaseYear: '2019', isrc: '', score: 90, spotifyUrl: '', appleMusicUrl: '' };
  };
  const hit = await identifyByFingerprint({ streamUrl: 'https://ice.example.net/mount', env, sampleImpl, recognizeImpl });
  assert.equal(hit.found, true);
  assert.equal(hit.artist, 'IU');
  assert.equal(hit.sampleBytes, 64 * 1024);

  const cachedHit = await identifyByFingerprint({ streamUrl: 'https://ice.example.net/mount', env, sampleImpl, recognizeImpl });
  assert.equal(cachedHit.cached, true);
  assert.equal(samples, 1);
  clearFingerprintCache();
});

test('desktop fingerprint sampling and recognition share one absolute deadline', async () => {
  clearFingerprintCache();
  const deadlineAt = Date.now() + 70;
  const observed = [];
  const startedAt = Date.now();
  const result = await identifyByFingerprint({
    streamUrl: 'https://ice.example.net/shared-operation-deadline',
    env: { AUDD_API_TOKEN: 'token' },
    deadlineAt,
    sampleImpl: async (_streamUrl, options) => {
      observed.push(['sample', options.deadlineAt]);
      await new Promise(resolve => setTimeout(resolve, 20));
      return { body: Buffer.alloc(64 * 1024, 1), contentType: 'audio/mpeg' };
    },
    recognizeImpl: async (_provider, _sample, _env, options) => {
      observed.push(['provider', options?.deadlineAt]);
      await new Promise(resolve => setTimeout(resolve, 160));
      return { provider: 'audd', artist: 'IU', title: 'Blueming', score: 90 };
    }
  });
  assert.equal(result.found, false);
  assert.equal(result.providerError, true);
  assert.ok(Date.now() - startedAt < 140, 'provider received a fresh timeout after sampling');
  assert.deepEqual(observed, [['sample', deadlineAt], ['provider', deadlineAt]]);
  clearFingerprintCache();
});

test('a deduplicated desktop fingerprint request still honors its own absolute deadline', async () => {
  clearFingerprintCache();
  let releaseProvider;
  const providerBarrier = new Promise(resolve => { releaseProvider = resolve; });
  const options = {
    streamUrl: 'https://ice.example.net/deduplicated-deadline',
    env: { AUDD_API_TOKEN: 'token' },
    sampleImpl: async () => ({ body: Buffer.alloc(64 * 1024, 1), contentType: 'audio/mpeg' }),
    recognizeImpl: async () => {
      await providerBarrier;
      return { provider: 'audd', artist: 'IU', title: 'Blueming', score: 90 };
    }
  };
  const first = identifyByFingerprint({ ...options, deadlineAt: Date.now() + 300 });
  await new Promise(resolve => setTimeout(resolve, 10));
  const startedAt = Date.now();
  const second = identifyByFingerprint({ ...options, deadlineAt: startedAt + 50 });
  const releaseTimer = setTimeout(releaseProvider, 150);
  try {
    await assert.rejects(second, /deadline/i);
    assert.ok(Date.now() - startedAt < 120, 'joined request inherited the first caller deadline');
  } finally {
    clearTimeout(releaseTimer);
    releaseProvider();
    await first;
    clearFingerprintCache();
  }
});

test('identifyByFingerprint reports short samples instead of spending recognition quota', async () => {
  clearFingerprintCache();
  const env = { AUDD_API_TOKEN: 'token' };
  const sampleImpl = async () => ({ body: Buffer.alloc(1024, 1), contentType: 'audio/mpeg' });
  const recognizeImpl = async () => { throw new Error('must not be called'); };
  const result = await identifyByFingerprint({ streamUrl: 'https://ice.example.net/short', env, sampleImpl, recognizeImpl });
  assert.equal(result.found, false);
  assert.match(result.reason, /too short/);
  clearFingerprintCache();
});

// --- Selected-station stream identity (earthradio:station-selected) ---

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveStreamUrl, shouldInvalidateStationIdentity } from '../site/assets/metadata-enrichment.js';

test('the long-lived ICY subscription rejects redirects instead of following them', () => {
  const request = new EventEmitter();
  request.setTimeout = () => {};
  request.destroy = () => {};
  let responseDestroyed = 0;
  const errors = [];
  subscribeIcyTitles(
    { url: new URL('https://radio.example/live'), hostname: 'radio.example', address: '1.1.1.1', family: 4 },
    () => assert.fail('a redirect must not yield metadata'),
    error => errors.push(error.message),
    {
      client: {
        get: (_url, _options, onResponse) => {
          onResponse({ statusCode: 302, destroy: () => { responseDestroyed += 1; } });
          return request;
        }
      }
    }
  );
  assert.deepEqual(errors, ['stream redirect blocked by now-playing resolver']);
  assert.equal(responseDestroyed, 1);
});

test('blob MediaSource playback resolves to the selected station URL', () => {
  assert.equal(
    resolveStreamUrl(
      { currentSrc: 'blob:https://site.example/id', src: 'blob:https://site.example/id' },
      'https://streams.example/live.m3u8'
    ),
    'https://streams.example/live.m3u8'
  );
  // A real HTTP(S) media source always wins over the remembered selection.
  assert.equal(
    resolveStreamUrl({ currentSrc: 'https://direct.example/ice' }, 'https://selected.example/live.m3u8'),
    'https://direct.example/ice'
  );
  // Non-HTTP(S) selections never leak into fetchable URLs.
  assert.equal(resolveStreamUrl({ currentSrc: 'blob:https://site.example/id' }, 'javascript:alert(1)'), '');
  assert.equal(resolveStreamUrl({ currentSrc: '' }, ''), '');
  assert.equal(resolveStreamUrl(null, 'https://selected.example/live.m3u8'), 'https://selected.example/live.m3u8');
});

test('stream resolution rejects HTTP-looking values that are not valid URLs', () => {
  // A prefix-only check would pass this malformed value to metadata endpoints.
  assert.equal(resolveStreamUrl({ currentSrc: 'https://' }, 'https://selected.example/live.m3u8'), 'https://selected.example/live.m3u8');
  assert.equal(resolveStreamUrl({ currentSrc: 'blob:https://site.example/id' }, 'https://'), '');
});

test('stream resolution preserves the original trimmed selected URL identity', () => {
  const selected = '  https://user:secret@streams.example:443/live.m3u8?token=abc  ';
  // The client stores this syntactically valid URL only as identity. Pages/Node own
  // authoritative private-target and credential rejection before any network fetch.
  assert.equal(resolveStreamUrl({ currentSrc: 'blob:https://site.example/id' }, selected), selected.trim());
  assert.equal(
    resolveStreamUrl({ currentSrc: 'blob:https://site.example/id' }, 'http://127.0.0.1:8000/live'),
    'http://127.0.0.1:8000/live'
  );
});

test('station identity fencing includes UUID when stream URLs are shared', () => {
  assert.equal(
    shouldInvalidateStationIdentity(
      { streamUrl: 'https://streams.example/shared.m3u8', stationUuid: 'station-a' },
      { streamUrl: 'https://streams.example/shared.m3u8', stationUuid: 'station-b' }
    ),
    true
  );
  assert.equal(
    shouldInvalidateStationIdentity(
      { streamUrl: 'https://streams.example/shared.m3u8', stationUuid: 'station-a' },
      { streamUrl: 'https://streams.example/shared.m3u8', stationUuid: 'station-a' }
    ),
    false
  );
});

test('media reattachment preserves canonical URL and UUID until a correlated transition', async () => {
  const metadata = await import('../site/assets/metadata-enrichment.js');
  assert.equal(typeof metadata.stationIdentityAfterTransition, 'function');
  const selected = {
    streamUrl: 'https://streams.example/live.m3u8',
    stationUuid: 'station-hls'
  };
  assert.deepEqual(
    metadata.stationIdentityAfterTransition(selected, { type: 'media-load', mediaUrl: 'blob:https://site.example/reattach' }),
    selected
  );
  assert.deepEqual(
    metadata.stationIdentityAfterTransition(selected, {
      type: 'selected',
      streamUrl: 'https://streams.example/next.m3u8',
      stationUuid: 'station-next'
    }),
    { streamUrl: 'https://streams.example/next.m3u8', stationUuid: 'station-next' }
  );
  assert.deepEqual(
    metadata.stationIdentityAfterTransition(selected, { type: 'clear' }),
    { streamUrl: '', stationUuid: '' }
  );
});

test('same-station platform polls accept only the newest generation', async () => {
  const metadata = await import('../site/assets/metadata-enrichment.js');
  assert.equal(typeof metadata.pollResultIsCurrent, 'function');
  const identity = { streamUrl: 'https://streams.example/live', stationUuid: 'station-a' };
  assert.equal(metadata.pollResultIsCurrent(
    { ...identity, generation: 4 },
    { ...identity, generation: 5 }
  ), false);
  assert.equal(metadata.pollResultIsCurrent(
    { ...identity, generation: 5 },
    { ...identity, generation: 5 }
  ), true);
  assert.equal(metadata.pollResultIsCurrent(
    { ...identity, generation: 5 },
    { streamUrl: identity.streamUrl, stationUuid: 'station-b', generation: 5 }
  ), false);
});

test('runtime source and installed bundle dispatch selections only on truthful playback results', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const source = await readFile(path.join(root, 'src-recovered', 'main.ts'), 'utf8');
  const bundle = await readFile(path.join(root, 'site', 'assets', 'index-690938fe.js'), 'utf8');
  for (const text of [source, bundle]) {
    assert.match(text, /earthradio:station-selected/);
    assert.match(text, /earthradio:stations-load-settled/);
    assert.match(text, /url_resolved/);
  }
  assert.match(source, /result\.ok && result\.station/);
  assert.match(bundle, /e\.ok&&e\.station&&await nc\(e\.station\)/);
  assert.match(source, /if \(stationLoadState\.queued\) return loadStations\(\)/);
  assert.match(bundle, /if\(_erLoadQueued\)return \$s\(\)/);
});

test('provider-supplied link URLs are restricted to web schemes', async () => {
  const { safeLinkHref } = await import('../site/assets/metadata-enrichment.js');
  assert.equal(safeLinkHref('https://open.spotify.com/track/abc'), 'https://open.spotify.com/track/abc');
  assert.equal(safeLinkHref('http://music.example/x'), 'http://music.example/x');
  assert.equal(safeLinkHref('javascript:alert(1)'), '');
  assert.equal(safeLinkHref('data:text/html,<script>1</script>'), '');
  assert.equal(safeLinkHref(''), '');
});

test('the listener market is derived from the browser locale for catalog enrichment', async () => {
  const { listenerCountry } = await import('../site/assets/metadata-enrichment.js');
  assert.equal(listenerCountry('en-US'), 'US');
  assert.equal(listenerCountry('ko'), 'KR');
  assert.equal(listenerCountry('pt-BR'), 'BR');
  assert.equal(listenerCountry(''), '');
  // The fingerprint request sends it so country-keyed server caches differentiate.
  const { readFile } = await import('node:fs/promises');
  const overlay = await readFile(new URL('../site/assets/metadata-enrichment.js', import.meta.url), 'utf8');
  assert.match(overlay, /params\.set\('country', country\)/);
});

test('a stalled specialized platform probe leaves budget for the generic fallbacks', async () => {
  const { clearPlatformNowPlayingCache, resolvePlatformNowPlaying } = await import('../server/platform-nowplaying.mjs');
  clearPlatformNowPlayingCache();
  const budgets = [];
  const startedAt = Date.now();
  const result = await resolvePlatformNowPlaying('https://radio.example.org/listen/my_station/radio.mp3', {
    timeoutMs: 800,
    fetchTextImpl: async (endpoint, { deadlineAt }) => {
      budgets.push({ platform: endpoint.platform, slice: deadlineAt - Date.now() });
      if (endpoint.platform === 'azuracast') {
        // The specialized endpoint black-holes until whatever deadline it was given.
        await new Promise(resolve => setTimeout(resolve, Math.max(0, deadlineAt - Date.now())));
        return '';
      }
      return JSON.stringify({ streamstatus: 1, songtitle: 'IU - Blueming' });
    }
  });
  const elapsed = Date.now() - startedAt;
  assert.equal(result.found, true, `generic fallback must still answer: ${JSON.stringify(result)}`);
  const specialized = budgets.find(entry => entry.platform === 'azuracast');
  assert.ok(specialized.slice < 700, `specialized probe must get a bounded slice, got ${specialized.slice}ms`);
  assert.ok(elapsed < 1200, `resolution stayed within the caller budget, took ${elapsed}ms`);
  clearPlatformNowPlayingCache();
});

test('SSE frame completion accepts CRLF delimiters and requires a data event', async () => {
  const { sseFrameComplete } = await import('../server/platform-detect.mjs');
  assert.equal(sseFrameComplete('data: {"streamTitle":"A - B"}\r\n\r\n'), true);
  assert.equal(sseFrameComplete('retry: 5000\ndata: {"x":1}\n\n'), true);
  // An initial comment/heartbeat frame carries no data and must keep the read open.
  assert.equal(sseFrameComplete(': heartbeat\r\n\r\n'), false);
  assert.equal(sseFrameComplete('data: {"incomplete":true}'), false);
  assert.equal(sseFrameComplete(''), false);
  // A heartbeat followed by a completed data frame stops the read.
  assert.equal(sseFrameComplete(': hi\r\n\r\ndata: {"streamTitle":"T"}\r\n\r\n'), true);
  // Both SSE readers must stop on this shared predicate, not a bare LF delimiter scan.
  const { readFile } = await import('node:fs/promises');
  for (const path of ['../server/platform-nowplaying.mjs', '../functions/api/nowplaying.js']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /sseFrameComplete\(/, `${path} must gate its SSE stop condition on sseFrameComplete`);
  }
});

test('delayed auto-fingerprints stay fenced to their originating stream and track', async () => {
  const { readFile } = await import('node:fs/promises');
  const overlay = await readFile(new URL('../site/assets/metadata-enrichment.js', import.meta.url), 'utf8');
  const start = overlay.indexOf('function maybeAutoFingerprint');
  assert.ok(start >= 0, 'maybeAutoFingerprint must exist');
  const timer = overlay.slice(start, overlay.indexOf('\n}', start));
  // The timer must re-derive the stream::track key when it fires and bail on any
  // mismatch, so a station change during the delay never spends metered quota.
  assert.match(timer, /state\.fingerprintAutoKey !== autoKey/);
  assert.match(timer, /`\$\{currentStreamUrl\(\)\}::\$\{state\.lastTrackKey\}` !== autoKey/);
});

test('desktop platform miss responses do not outlive the polling interval in HTTP caches', async () => {
  const { handlePlatformNowPlaying } = await import('../server/metadata-api.mjs');
  const call = async payload => {
    const captured = {};
    const req = {
      url: '/api/streams/platform-nowplaying?url=https%3A%2F%2Fstream.example%2Fa.mp3',
      method: 'GET',
      socket: { remoteAddress: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
      headers: {}
    };
    const res = {
      writeHead: (status, headers) => Object.assign(captured, { status, headers }),
      end: () => {}
    };
    await handlePlatformNowPlaying(req, res, { resolveImpl: async () => payload });
    return captured;
  };
  const hit = await call({ found: true, artist: 'A', title: 'B' });
  assert.equal(hit.headers['cache-control'], 'public, max-age=15');
  // The renderer polls every 30 seconds; a longer miss max-age lets the browser
  // HTTP cache replay the miss after the resolver's own miss TTL expired.
  const miss = await call({ found: false });
  const missAge = Number(miss.headers['cache-control'].match(/max-age=(\d+)/)?.[1]);
  assert.ok(missAge <= 30, `miss max-age ${missAge} must not exceed the 30s polling interval`);
});

test('provider outages never populate the negative identify cache', async () => {
  const { clearIdentifyCache, identifyTrack } = await import('../server/metadata-providers.mjs');
  clearIdentifyCache();
  const realFetch = globalThis.fetch;
  const calls = [];
  const args = { artist: 'Miles Davis', title: 'So What', providers: ['itunes'], country: 'US', timeoutMs: 500 };
  try {
    globalThis.fetch = async url => { calls.push(String(url)); throw new Error('offline'); };
    const outage = await identifyTrack(args);
    assert.equal(outage.found, false);
    assert.ok(calls.length > 0, 'the provider must have been queried');

    // Providers recover: the same request must reach them again instead of
    // replaying the outage as a cached Raw ICY miss for the negative TTL.
    globalThis.fetch = async url => {
      calls.push(String(url));
      return new Response(JSON.stringify({ results: [] }), { headers: { 'content-type': 'application/json' } });
    };
    const before = calls.length;
    const genuine = await identifyTrack(args);
    assert.equal(genuine.found, false);
    assert.ok(calls.length > before, 'a transient outage miss must not be served from the negative cache');

    // A genuine catalog miss IS negative-cacheable: no further provider traffic.
    const after = calls.length;
    const cached = await identifyTrack(args);
    assert.equal(cached.cached, true);
    assert.equal(calls.length, after);
  } finally {
    globalThis.fetch = realFetch;
    clearIdentifyCache();
  }
});
