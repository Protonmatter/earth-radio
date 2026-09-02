// Shared e2e helpers: hermetic route interception, generated audio, and common flows.

import { expect } from '@playwright/test';
import { hlsFixtureResponse } from './fixtures/hls-media.mjs';
import { EXPANSION_STATIONS, FIXTURE_COUNTRIES, FIXTURE_STATIONS } from './fixtures/stations.mjs';

// Silent 8kHz mono 16-bit PCM WAV; long enough that playback never ends mid-test.
export function silentWav(seconds = 30) {
  const sampleRate = 8000;
  const dataSize = sampleRate * seconds * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

const AUDIO = silentWav();
const ALL_STATIONS = [...FIXTURE_STATIONS, ...EXPANSION_STATIONS];

export async function setupApp(page, { sameOriginNowPlaying = null, sameOriginFingerprint = null, enableAuth = false } = {}) {
  // Chrome 151+ (the build CI's `playwright install chromium` provides) answers
  // canPlayType('application/vnd.apple.mpegurl') with 'maybe', so the runtime takes
  // its native-HLS branch and never creates the MediaSource blob: source these tests
  // exist to pin. Force the no-native-HLS answer so every browser build exercises
  // the hls.js path deterministically — the scenario production Firefox and older
  // Chromium actually hit.
  await page.addInitScript(() => {
    const nativeCanPlayType = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (type) {
      if (/mpegurl/i.test(String(type))) return '';
      return nativeCanPlayType.call(this, type);
    };
  });
  // Stream URLs the page sent to the same-origin fingerprint endpoint, in order.
  const fingerprintRequests = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') {
      // Optionally emulate the same-origin Pages Function API in front of the static server.
      if (sameOriginNowPlaying && url.pathname === '/api/nowplaying') {
        if (!url.searchParams.get('url')) return route.fulfill({ json: { ok: true, service: 'earth-radio-pages-fn' } });
        return route.fulfill({ json: sameOriginNowPlaying });
      }
      if ((sameOriginNowPlaying || sameOriginFingerprint) && url.pathname === '/api/track/fingerprint') {
        const streamUrl = url.searchParams.get('url') || '';
        if (!sameOriginFingerprint) return route.fulfill({ json: { available: false, providers: [] } });
        if (!streamUrl) return route.fulfill({ json: { available: true, providers: ['audd'] } });
        fingerprintRequests.push(streamUrl);
        return route.fulfill({ json: sameOriginFingerprint });
      }
      return route.continue();
    }
    if (url.hostname.endsWith('api.radio-browser.info')) {
      const pathname = url.pathname;
      if (pathname.includes('/json/stations/topclick')) return route.fulfill({ json: FIXTURE_STATIONS });
      if (pathname.includes('/json/stations/search')) {
        const countryCode = (url.searchParams.get('countrycode') || '').toUpperCase();
        return route.fulfill({ json: ALL_STATIONS.filter(s => !countryCode || s.countrycode === countryCode) });
      }
      if (pathname.includes('/json/countries')) return route.fulfill({ json: FIXTURE_COUNTRIES });
      if (pathname.includes('/json/url/')) return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: [] });
    }
    if (url.hostname === 'listen.moe' || url.hostname.endsWith('.listen.moe')) {
      return route.fulfill({ contentType: 'audio/wav', body: AUDIO });
    }
    if (url.hostname === 'streams.e2e.example') {
      const hls = hlsFixtureResponse(url.pathname, route.request().method());
      if (hls) return route.fulfill(hls);
      return route.fulfill({ contentType: 'audio/wav', body: AUDIO });
    }
    // Hosted GoTrue. The provider controls are painted only from what
    // /auth/v1/settings reports, so without this the catch-all below would abort the
    // request, leave `liveProviders` null, and the dialog would offer email only.
    if (enableAuth && url.hostname.endsWith('.supabase.co')) {
      if (url.pathname === '/auth/v1/settings') {
        return route.fulfill({ json: { external: { github: true, google: true } } });
      }
      return route.fulfill({ status: 400, json: { error: 'unsupported_in_e2e' } });
    }
    // Map tiles, other directories, favicons: fail fast and deterministically.
    return route.abort();
  });
  if (enableAuth) {
    await page.route('**/config.js', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "window.location.origin === 'https://earth-radio.pages.dev'",
        'true'
      );
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store'
        },
        body
      });
    });
  }
  await page.goto('/');
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20_000 });
  return { fingerprintRequests };
}

export function card(page, name) {
  return page.locator('.station-card', { hasText: name }).first();
}

export async function revealCard(page, name) {
  const target = card(page, name);
  // The station list is virtualized: a card below the fold has no DOM node until the
  // grid scrolls near it, and scrollIntoViewIfNeeded on a nonexistent node waits
  // forever. Step the grid until the card materializes.
  await expect.poll(async () => {
    if (await target.count()) return true;
    await page.locator('#station-grid').evaluate(grid => { grid.scrollTop += grid.clientHeight; });
    return false;
  }, { timeout: 15_000, message: `station card "${name}" never materialized` }).toBe(true);
  await target.scrollIntoViewIfNeeded();
  return target;
}

export async function playFromList(page, name) {
  const target = await revealCard(page, name);
  await target.locator('.station-card__play').click();
  await expect(page.locator('#player-station')).toHaveText(name, { timeout: 15_000 });
}

export function audioPaused(page) {
  return page.evaluate(() => document.getElementById('audio-player')?.paused ?? true);
}
