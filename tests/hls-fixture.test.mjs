import assert from 'node:assert/strict';
import test from 'node:test';
import { HLS_INIT_SEGMENT, HLS_MEDIA_SEGMENT, HLS_PLAYLIST, hlsFixtureResponse } from './e2e/fixtures/hls-media.mjs';

function boxType(buffer, offset) {
  return buffer.subarray(offset + 4, offset + 8).toString('ascii');
}

test('the HLS fixture provides coherent fMP4 init and media segments', () => {
  assert.equal(boxType(HLS_INIT_SEGMENT, 0), 'ftyp');
  assert.match(HLS_INIT_SEGMENT.toString('ascii'), /moov/);
  assert.equal(boxType(HLS_MEDIA_SEGMENT, 0), 'styp');
  assert.match(HLS_MEDIA_SEGMENT.toString('ascii'), /moof/);
  assert.match(HLS_MEDIA_SEGMENT.toString('ascii'), /mdat/);
  assert.match(HLS_PLAYLIST, /#EXT-X-MAP:URI="init\.mp4"/);
  assert.match(HLS_PLAYLIST, /segment\.m4s/);
});

test('every HLS fixture response is CORS-readable and has the matching media contract', () => {
  for (const [pathname, contentType, signature] of [
    ['/hls/master.m3u8', 'application/vnd.apple.mpegurl', '#EXTM3U'],
    ['/hls/init.mp4', 'video/mp4', 'ftyp'],
    ['/hls/segment.m4s', 'video/iso.segment', 'styp']
  ]) {
    const response = hlsFixtureResponse(pathname);
    assert.equal(response.status, 200);
    assert.equal(response.headers['access-control-allow-origin'], '*');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['content-type'], contentType);
    assert.match(Buffer.from(response.body).toString('ascii'), new RegExp(signature));
  }
  const preflight = hlsFixtureResponse('/hls/segment.m4s', 'OPTIONS');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-methods'], 'GET, OPTIONS');
  assert.match(preflight.headers['access-control-allow-headers'], /range/i);
});
