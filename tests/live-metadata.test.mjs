import assert from 'node:assert/strict';
import test from 'node:test';
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
import { resolveStreamUrl } from '../site/assets/metadata-enrichment.js';

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

test('runtime source and installed bundle both dispatch the selection and settle events', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const source = await readFile(path.join(root, 'src-recovered', 'main.ts'), 'utf8');
  const bundle = await readFile(path.join(root, 'site', 'assets', 'index-B4rKOAHV.js'), 'utf8');
  for (const text of [source, bundle]) {
    assert.match(text, /earthradio:station-selected/);
    assert.match(text, /earthradio:stations-load-settled/);
    assert.match(text, /url_resolved/);
  }
});

test('platform resolution shares one wall-clock budget across candidate endpoints', async () => {
  clearPlatformNowPlayingCache();
  const budgets = [];
  const startedAt = Date.now();
  const result = await resolvePlatformNowPlaying('https://ice.example.net:8000/live.mp3', {
    timeoutMs: 800,
    fetchTextImpl: async (endpoint, budget) => {
      budgets.push(budget);
      if (budgets.length === 1) {
        // First endpoint stalls for its entire slice, like a black-holed status page.
        await new Promise(resolve => setTimeout(resolve, budget));
        return '';
      }
      // The surviving generic fallback (shoutcast) answers with its own payload shape.
      return JSON.stringify({ streamstatus: 1, songtitle: 'IU - Blueming' });
    }
  });
  const elapsed = Date.now() - startedAt;
  assert.equal(result.found, true, `fallback endpoint must still be reached: ${JSON.stringify(result)}`);
  assert.ok(budgets.length >= 2, 'the second endpoint was attempted');
  assert.ok(budgets[0] < 800, `first endpoint must not receive the whole budget, got ${budgets[0]}ms`);
  assert.ok(elapsed < 1200, `resolution stayed within the caller budget, took ${elapsed}ms`);
  clearPlatformNowPlayingCache();
});

test('trusted feed results own the panel only for their freshness window', async () => {
  const { trustedFreshRemaining } = await import('../site/assets/metadata-enrichment.js');
  const now = 1_000_000;
  assert.equal(trustedFreshRemaining(null, now), 0);
  assert.equal(trustedFreshRemaining({ at: now - 60_000 }, now), 0);
  const remaining = trustedFreshRemaining({ at: now - 10_000 }, now);
  assert.ok(remaining > 0 && remaining <= 45_000, `mid-window remaining is bounded, got ${remaining}`);
  // The overlay must arm a re-process at expiry: without it, a finished song would
  // stay on the panel whenever the platform feed goes quiet and the DOM stops mutating.
  const overlay = await readFile(path.resolve(import.meta.dirname, '..', 'site', 'assets', 'metadata-enrichment.js'), 'utf8');
  assert.match(overlay, /trustExpiryTimer = setTimeout\(scheduleProcess/);
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
  assert.equal(listenerCountry('zzzz-not-a-locale!!'), '');
});

test('settle events are correlated with forced refreshes', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const source = await readFile(path.join(root, 'src-recovered', 'main.ts'), 'utf8');
  const bundle = await readFile(path.join(root, 'site', 'assets', 'index-B4rKOAHV.js'), 'utf8');
  // Both dispatch sites carry the forceRefresh flag in the settle detail...
  assert.match(source, /stations-load-settled', \{ detail: \{ ok, forceRefresh \} \}/);
  assert.match(bundle, /stations-load-settled`,\{detail:\{ok:_ok,forceRefresh:e\}\}/);
  // ...and the expansion overlay ignores settles of unforced (boot) loads, so an
  // unrelated concurrent load cannot release its refresh queue early.
  const overlay = await readFile(path.join(root, 'site', 'assets', 'directory-expansion.js'), 'utf8');
  assert.match(overlay, /forceRefresh === false\) return/);
});
