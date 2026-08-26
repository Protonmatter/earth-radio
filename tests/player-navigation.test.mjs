import assert from 'node:assert/strict';
import test from 'node:test';
import { playbackResult } from '../src-recovered/core/playback-result.js';

const station = { stationuuid: 'next-station', name: 'Next' };

test('navigation playback result never reports a station as selected when playback fails', () => {
  assert.deepEqual(playbackResult(station, false), { station: null, ok: false });
});

test('navigation playback result preserves the station only after successful playback', () => {
  assert.deepEqual(playbackResult(station, true), { station, ok: true });
  assert.deepEqual(playbackResult(null, true), { station: null, ok: false });
});
