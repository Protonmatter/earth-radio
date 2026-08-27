import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFingerprintPayload } from '../server/metadata-api.mjs';
import { coherentHlsTail } from '../server/hls-playlist.mjs';
import { clearFingerprintCache, identifyByFingerprint } from '../server/fingerprint-providers.mjs';

test('desktop catalog enrichment inherits the sampling and provider deadline', async () => {
  const deadlineAt = Date.now() + 70;
  const observed = [];
  const startedAt = Date.now();
  const payload = await resolveFingerprintPayload({
    streamUrl: 'https://ice.example.net/deadline-enrichment',
    country: 'US',
    deadlineAt,
    fingerprintImpl: async options => {
      observed.push(['fingerprint', options.deadlineAt]);
      return {
        available: true,
        found: true,
        provider: 'audd',
        artist: 'IU',
        title: 'Blueming',
        score: 90,
        fetchedAt: new Date().toISOString()
      };
    },
    catalogImpl: async options => {
      observed.push(['catalog', options.deadlineAt]);
      await new Promise(resolve => setTimeout(resolve, 160));
      return { found: true, artworkUrl: 'https://art.example/late.jpg' };
    }
  });

  assert.equal(payload.found, true, 'a valid fingerprint remains authoritative when optional enrichment times out');
  assert.equal(payload.artworkUrl, '');
  assert.ok(Date.now() - startedAt < 140, 'catalog enrichment received a fresh timeout');
  assert.deepEqual(observed, [['fingerprint', deadlineAt], ['catalog', deadlineAt]]);
});

test('offset-less EXT-X-MAP BYTERANGE continues after the previous sub-range', () => {
  const parsed = coherentHlsTail([
    '#EXTM3U',
    '#EXT-X-MAP:URI="media.mp4",BYTERANGE="500"',
    '#EXT-X-BYTERANGE:1000',
    'media.mp4',
    '#EXT-X-BYTERANGE:1000',
    'media.mp4'
  ]);
  assert.deepEqual(parsed.map, { uri: 'media.mp4', range: { offset: 0, length: 500 } });
  assert.deepEqual(parsed.segments, [
    { uri: 'media.mp4', range: { offset: 500, length: 1000 } },
    { uri: 'media.mp4', range: { offset: 1500, length: 1000 } }
  ]);
});

test('repeated identical EXT-X-MAP declarations keep the coherent fragment tail', () => {
  const parsed = coherentHlsTail([
    '#EXTM3U',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:4,',
    'seg1.m4s',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:4,',
    'seg2.m4s',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:4,',
    'seg3.m4s'
  ]);
  assert.deepEqual(parsed.map, { uri: 'init.mp4', range: null });
  assert.deepEqual(parsed.segments.map(segment => segment.uri), ['seg1.m4s', 'seg2.m4s', 'seg3.m4s']);
});

test('deadline-aborted desktop fingerprint samples are not miss-cached', async () => {
  clearFingerprintCache();
  let samples = 0;
  const env = { AUDD_API_TOKEN: 'token' };
  const sampleImpl = async () => {
    samples += 1;
    throw new Error('fingerprint deadline exceeded');
  };
  const recognizeImpl = async () => { throw new Error('must not spend recognition quota'); };
  const first = await identifyByFingerprint({
    streamUrl: 'https://ice.example.net/slow-sample',
    env,
    sampleImpl,
    recognizeImpl
  });
  assert.equal(first.found, false);
  assert.match(first.reason, /sampling failed/);
  assert.equal(first.cached, undefined);

  const second = await identifyByFingerprint({
    streamUrl: 'https://ice.example.net/slow-sample',
    env,
    sampleImpl,
    recognizeImpl
  });
  assert.equal(second.found, false);
  assert.equal(second.cached, undefined);
  assert.equal(samples, 2, 'a deadline miss must not occupy the 30s miss TTL');
  clearFingerprintCache();
});

test('attempt-limit sampling failures are not miss-cached either', async () => {
  clearFingerprintCache();
  let samples = 0;
  const env = { AUDD_API_TOKEN: 'token' };
  const sampleImpl = async () => {
    samples += 1;
    const error = new Error('fetch attempt limit exceeded');
    error.code = 'ERR_FETCH_ATTEMPT_LIMIT';
    throw error;
  };
  const first = await identifyByFingerprint({
    streamUrl: 'https://ice.example.net/attempt-limit',
    env,
    sampleImpl,
    recognizeImpl: async () => null
  });
  assert.match(first.reason, /sampling failed/);
  await identifyByFingerprint({
    streamUrl: 'https://ice.example.net/attempt-limit',
    env,
    sampleImpl,
    recognizeImpl: async () => null
  });
  assert.equal(samples, 2);
  clearFingerprintCache();
});

test('a genuine desktop fingerprint miss remains cached', async () => {
  clearFingerprintCache();
  let samples = 0;
  const env = { AUDD_API_TOKEN: 'token' };
  const sampleImpl = async () => {
    samples += 1;
    return { body: Buffer.alloc(64 * 1024, 1), contentType: 'audio/mpeg' };
  };
  const miss = await identifyByFingerprint({
    streamUrl: 'https://ice.example.net/quiet-miss',
    env,
    sampleImpl,
    recognizeImpl: async () => null
  });
  assert.equal(miss.found, false);
  assert.equal(miss.reason, 'no fingerprint match');
  const cached = await identifyByFingerprint({
    streamUrl: 'https://ice.example.net/quiet-miss',
    env,
    sampleImpl,
    recognizeImpl: async () => null
  });
  assert.equal(cached.cached, true);
  assert.equal(samples, 1);
  clearFingerprintCache();
});
