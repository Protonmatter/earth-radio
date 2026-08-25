// Public-web now-playing: the same-origin Pages Function API feeds real track info to
// the metadata panel, and station facts (country · bitrate · codec) are never mistaken
// for a track title.

import { expect, test } from '@playwright/test';
import { playFromList, setupApp } from './helpers.mjs';

test('same-origin now-playing feed surfaces the track in the metadata panel', async ({ page }) => {
  await setupApp(page, {
    sameOriginNowPlaying: {
      found: true,
      source: 'icy',
      platform: 'icy',
      artist: 'IU',
      title: 'Blueming',
      raw: 'IU - Blueming'
    }
  });
  await playFromList(page, 'E2E Seoul Pop');

  const details = page.locator('#metadata-details');
  await expect(details).toContainText('Blueming', { timeout: 25_000 });
  await expect(details).toContainText('IU');
  // Catalogs are unreachable in the hermetic run, so the honest state is the
  // structured station feed, not a fabricated identification.
  await expect(page.locator('#metadata-state')).toHaveText(/Station feed|Identified|Likely match/);
});

test('fingerprinting keeps the selected station URL when playback is MediaSource-backed', async ({ page }) => {
  const { fingerprintRequests } = await setupApp(page, {
    sameOriginNowPlaying: { found: false, reason: 'no track data' },
    sameOriginFingerprint: {
      available: true,
      found: true,
      provider: 'audd',
      artist: 'IU',
      title: 'Blueming',
      confidence: 92,
      state: 'Identified'
    }
  });
  await playFromList(page, 'E2E Seoul Pop');

  // Simulate an hls.js takeover: MediaSource playback exposes only a blob: URL. The
  // element keeps playing the real audio (swapping in an empty MediaSource would trip
  // the app's stalled-playback auto-skip); only the URL getters are masked, then the
  // runtime-order earthradio:station-selected event announces the canonical selection.
  // The announced HLS URL is deliberately absent from the cached directory so only the
  // event can supply it.
  await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    Object.defineProperty(audio, 'currentSrc', { get: () => 'blob:https://e2e.example/mediasource' });
    Object.defineProperty(audio, 'src', { get: () => 'blob:https://e2e.example/mediasource', set: () => {} });
  });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('earthradio:station-selected', {
      detail: { streamUrl: 'https://streams.e2e.example/hls/master.m3u8', stationUuid: 'e2e-seoul-0001' }
    }));
  });

  const button = page.locator('#metadata-fingerprint-btn');
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();

  await expect(page.locator('#metadata-details')).toContainText('Blueming', { timeout: 30_000 });
  expect(fingerprintRequests).toContain('https://streams.e2e.example/hls/master.m3u8');
});

test('station facts are never presented as a track title', async ({ page }) => {
  await setupApp(page);
  await playFromList(page, 'E2E Seoul Pop');

  // Without any live feed the panel stays honest: no title scraped from the
  // "country · bitrate · codec" station line.
  await page.waitForTimeout(1500);
  await expect(page.locator('#metadata-state')).toHaveText('Station metadata only');
  await expect(page.locator('#metadata-details')).not.toContainText('The Republic Of Korea');
});
