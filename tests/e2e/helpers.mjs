// Shared e2e helpers: hermetic route interception, generated audio, and common flows.

import { expect } from '@playwright/test';
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

export async function setupApp(page, { sameOriginNowPlaying = null } = {}) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') {
      // Optionally emulate the same-origin Pages Function API in front of the static server.
      if (sameOriginNowPlaying && url.pathname === '/api/nowplaying') {
        if (!url.searchParams.get('url')) return route.fulfill({ json: { ok: true, service: 'earth-radio-pages-fn' } });
        return route.fulfill({ json: sameOriginNowPlaying });
      }
      if (sameOriginNowPlaying && url.pathname === '/api/track/fingerprint') {
        return route.fulfill({ json: { available: false, providers: [] } });
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
    if (url.hostname === 'streams.e2e.example') {
      return route.fulfill({ contentType: 'audio/wav', body: AUDIO });
    }
    // Map tiles, other directories, favicons: fail fast and deterministically.
    return route.abort();
  });
  await page.goto('/');
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20_000 });
}

export function card(page, name) {
  return page.locator('.station-card', { hasText: name }).first();
}

export async function playFromList(page, name) {
  const target = card(page, name);
  await target.scrollIntoViewIfNeeded();
  await target.locator('.station-card__play').click();
  await expect(page.locator('#player-station')).toHaveText(name, { timeout: 15_000 });
}

export function audioPaused(page) {
  return page.evaluate(() => document.getElementById('audio-player')?.paused ?? true);
}
