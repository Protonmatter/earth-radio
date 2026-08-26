import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFingerprintPayload } from '../server/metadata-api.mjs';
import { coherentHlsTail } from '../server/hls-playlist.mjs';

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
