// Public-web now-playing: the same-origin Pages Function API feeds real track info to
// the metadata panel, and station facts (country · bitrate · codec) are never mistaken
// for a track title.

import { expect, test } from '@playwright/test';
import { card, playFromList, setupApp } from './helpers.mjs';

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
  await expect(page.locator('#nowcard-title')).toHaveText('Blueming');
  await expect(page.locator('#player-track')).toContainText('Blueming');
  await expect(page.locator('#player-track')).toContainText('IU');
  await page.locator('#er-open-nowplaying').click();
  await expect(page.locator('#er-nowplaying-title')).toHaveText('Blueming');
  await expect(page.locator('#er-nowplaying-meta')).toContainText('IU');
});

test('successful playback dispatches the original selected stream URL and station UUID', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    window.__stationSelectedEvents = [];
    window.addEventListener('earthradio:station-selected', event => {
      window.__stationSelectedEvents.push(event.detail);
    });
  });

  await playFromList(page, 'E2E Seoul Pop');
  await expect.poll(() => page.evaluate(() => window.__stationSelectedEvents)).toEqual([
    { streamUrl: 'https://streams.e2e.example/seoul.mp3', stationUuid: 'e2e-seoul-0001' }
  ]);
});

test('next and previous controls emit only after their navigation playback succeeds', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    window.__stationSelectedEvents = [];
    window.addEventListener('earthradio:station-selected', event => window.__stationSelectedEvents.push(event.detail));
  });
  await playFromList(page, 'E2E Seoul Pop');
  await page.locator('#btn-next').click();
  await expect.poll(() => page.evaluate(() => window.__stationSelectedEvents.at(-1))).toEqual(
    { streamUrl: 'https://streams.e2e.example/hls/master.m3u8', stationUuid: 'e2e-hls-0009' }
  );
  await page.locator('#btn-prev').click();
  await expect.poll(() => page.evaluate(() => window.__stationSelectedEvents.at(-1))).toEqual(
    { streamUrl: 'https://streams.e2e.example/seoul.mp3', stationUuid: 'e2e-seoul-0001' }
  );
});

test('the Media Session next-track path uses the same successful-navigation event gate', async ({ page }) => {
  await page.addInitScript(() => {
    const handlers = {};
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        metadata: null,
        playbackState: 'none',
        setActionHandler(action, handler) { handlers[action] = handler; }
      }
    });
    Object.defineProperty(window, 'MediaMetadata', {
      configurable: true,
      value: class MediaMetadata { constructor(init) { Object.assign(this, init); } }
    });
    window.__mediaSessionHandlers = handlers;
  });
  await setupApp(page);
  await page.evaluate(() => {
    window.__stationSelectedEvents = [];
    window.addEventListener('earthradio:station-selected', event => window.__stationSelectedEvents.push(event.detail));
  });
  await playFromList(page, 'E2E Seoul Pop');
  await page.evaluate(() => window.__mediaSessionHandlers.nexttrack());
  await expect.poll(() => page.evaluate(() => window.__stationSelectedEvents.at(-1))).toEqual(
    { streamUrl: 'https://streams.e2e.example/hls/master.m3u8', stationUuid: 'e2e-hls-0009' }
  );
});

test('actual HLS selection preserves the original source through MediaSource playback', async ({ page }) => {
  const nowPlayingRequests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/nowplaying' && url.searchParams.get('url')) nowPlayingRequests.push(url.searchParams.get('url'));
  });
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
  await page.evaluate(() => {
    window.__stationSelectedEvents = [];
    window.addEventListener('earthradio:station-selected', event => window.__stationSelectedEvents.push(event.detail));
  });
  await playFromList(page, 'E2E HLS Source');
  await expect.poll(() => page.evaluate(() => window.__stationSelectedEvents)).toEqual([
    { streamUrl: 'https://streams.e2e.example/hls/master.m3u8', stationUuid: 'e2e-hls-0009' }
  ]);
  await expect.poll(() => page.evaluate(() => document.getElementById('audio-player')?.currentSrc.startsWith('blob:'))).toBe(true);

  const button = page.locator('#metadata-fingerprint-btn');
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();

  await expect(page.locator('#metadata-details')).toContainText('Blueming', { timeout: 30_000 });
  expect(fingerprintRequests).toContain('https://streams.e2e.example/hls/master.m3u8');
  await expect.poll(() => nowPlayingRequests).toContain('https://streams.e2e.example/hls/master.m3u8');
});

test('HLS reconnect keeps the canonical identity after its active card is virtualized away', async ({ page }) => {
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
  await playFromList(page, 'E2E HLS Source');
  await expect.poll(() => page.evaluate(() => document.getElementById('audio-player')?.currentSrc.startsWith('blob:'))).toBe(true);

  await page.locator('#station-grid').evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(page.locator('.station-card--active')).toHaveCount(0);
  await page.evaluate(() => {
    const audio = document.getElementById('audio-player');
    window.__hlsReconnectLoads = 0;
    audio.addEventListener('loadstart', () => { window.__hlsReconnectLoads += 1; });
    Object.defineProperty(audio, 'error', {
      configurable: true,
      value: { code: 2, message: 'fixture transient network failure' }
    });
    audio.dispatchEvent(new Event('error'));
  });
  await expect.poll(() => page.evaluate(() => window.__hlsReconnectLoads), { timeout: 5000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => document.getElementById('audio-player')?.currentSrc.startsWith('blob:'))).toBe(true);

  const button = page.locator('#metadata-fingerprint-btn');
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
  await expect.poll(() => fingerprintRequests).toContain('https://streams.e2e.example/hls/master.m3u8');
});

test('the cloned Now Playing Identify action invokes and mirrors the canonical fingerprint action', async ({ page }) => {
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
  await expect(page.locator('#metadata-fingerprint-btn')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#er-open-nowplaying').click();

  const clonedButton = page.locator('#er-nowplaying [data-click-id="metadata-fingerprint-btn"]');
  await expect(clonedButton).toBeEnabled();
  await clonedButton.click();

  await expect.poll(() => fingerprintRequests).toContain('https://streams.e2e.example/seoul.mp3');
  await expect(page.locator('#metadata-state')).toHaveText('Identified');
  await expect(page.locator('#er-nowplaying-metadata')).toContainText('Blueming');
  await expect(page.locator('#er-nowplaying-metadata')).toContainText(/Matched by audio fingerprint/);
});

test('same-URL station switches fence stale platform responses by UUID', async ({ page }) => {
  await setupApp(page, { sameOriginNowPlaying: { found: false, reason: 'no track data' } });
  let requestStarted;
  const requestBarrier = new Promise(resolve => { requestStarted = resolve; });
  let releaseResponse;
  const responseBarrier = new Promise(resolve => { releaseResponse = resolve; });
  let responseFinished;
  const responseFinishedBarrier = new Promise(resolve => { responseFinished = resolve; });
  let requests = 0;
  await page.route('**/api/nowplaying?*', async route => {
    const streamUrl = new URL(route.request().url()).searchParams.get('url');
    if (streamUrl === 'https://streams.e2e.example/hls/master.m3u8' && requests++ === 0) {
      requestStarted();
      await responseBarrier;
      await route.fulfill({ json: { found: true, artist: 'Stale Artist', title: 'Stale Song' } });
      responseFinished();
      return;
    }
    return route.fulfill({ json: { found: false, reason: 'no track data' } });
  });
  await playFromList(page, 'E2E HLS Source');
  await requestBarrier;
  await playFromList(page, 'E2E HLS Mirror');
  releaseResponse();
  await responseFinishedBarrier;
  await expect(page.locator('#metadata-details')).not.toContainText('Stale Song');
  await expect(page.locator('#metadata-details')).not.toContainText('Stale Artist');
});

test('an invalid selection event cannot replace an actual HLS station identity', async ({ page }) => {
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
  await playFromList(page, 'E2E HLS Source');
  // This validates rejection only; the selected MediaSource state came from the real
  // controller/selection path above and is never manufactured by the test.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('earthradio:station-selected', {
    detail: { streamUrl: 'https://', stationUuid: 'invalid-station' }
  })));
  const button = page.locator('#metadata-fingerprint-btn');
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
  await expect.poll(() => fingerprintRequests).toContain('https://streams.e2e.example/hls/master.m3u8');
  expect(fingerprintRequests).not.toContain('https://');
});

test('failed playback dispatches no station selection event', async ({ page }) => {
  await page.addInitScript(() => { window.RADIO_CONFIG = { autoSkipOnPlaybackError: false }; });
  await setupApp(page);
  await page.evaluate(() => {
    window.__stationSelectedEvents = [];
    window.addEventListener('earthradio:station-selected', event => {
      window.__stationSelectedEvents.push(event.detail);
    });
    const audio = document.getElementById('audio-player');
    audio.play = () => Promise.reject(new DOMException('blocked by fixture', 'NotAllowedError'));
  });

  await card(page, 'E2E Seoul Pop').locator('.station-card__play').click();
  await expect(page.locator('#status-line')).toContainText(/Playback failed|Station unavailable/, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => window.__stationSelectedEvents.length)).toBe(0);
});

test('a stale platform response cannot overwrite the newly selected station identity', async ({ page }) => {
  await setupApp(page, { sameOriginNowPlaying: { found: false, reason: 'no track data' } });
  let staleRequestStarted;
  const staleRequestBarrier = new Promise(resolve => { staleRequestStarted = resolve; });
  let releaseStaleResponse;
  const staleResponseBarrier = new Promise(resolve => { releaseStaleResponse = resolve; });
  let staleResponseFinished;
  const staleResponseFinishedBarrier = new Promise(resolve => { staleResponseFinished = resolve; });
  await page.route('**/api/nowplaying?*', async route => {
    const streamUrl = new URL(route.request().url()).searchParams.get('url');
    if (streamUrl === 'https://streams.e2e.example/seoul.mp3') {
      staleRequestStarted();
      await staleResponseBarrier;
      await route.fulfill({ json: { found: true, artist: 'Stale Artist', title: 'Stale Song' } });
      staleResponseFinished();
      return;
    }
    return route.fulfill({ json: { found: false, reason: 'no track data' } });
  });
  await playFromList(page, 'E2E Seoul Pop');
  await staleRequestBarrier;
  await playFromList(page, 'E2E London Jazz');
  releaseStaleResponse();
  await staleResponseFinishedBarrier;

  await expect(page.locator('#metadata-details')).not.toContainText('Stale Song');
  await expect(page.locator('#metadata-details')).not.toContainText('Stale Artist');
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
