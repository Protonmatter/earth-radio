// End-to-end UI tests for the recovered Earth Radio site.
// Focus: idempotency of repeated user actions and progressive disclosure on the map.
// All external traffic is intercepted, so runs are hermetic and deterministic.

import { expect, test } from '@playwright/test';
import { FIXTURE_STATIONS } from './fixtures/stations.mjs';

// 1 second of silent 8kHz mono 16-bit PCM in a WAV container; enough for the
// <audio> element to reach "playing" without any real stream.
function silentWav() {
  const sampleRate = 8000;
  const samples = sampleRate;
  const dataSize = samples * 2;
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

async function setupApp(page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname.endsWith('api.radio-browser.info')) {
      const pathname = url.pathname;
      if (pathname.includes('/json/stations/topclick')) return route.fulfill({ json: FIXTURE_STATIONS });
      if (pathname.includes('/json/stations/search')) {
        const countryCode = url.searchParams.get('countrycode');
        return route.fulfill({ json: FIXTURE_STATIONS.filter(s => !countryCode || s.countrycode === countryCode.toUpperCase()) });
      }
      if (pathname.includes('/json/url/')) return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: [] });
    }
    if (url.hostname === 'streams.e2e.example') {
      return route.fulfill({ contentType: 'audio/wav', body: AUDIO });
    }
    // Map tiles, icecast directory, favicons, anything else: fail fast and deterministically.
    return route.abort();
  });
  await page.goto('/');
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20_000 });
}

function card(page, name) {
  return page.locator('.station-card', { hasText: name }).first();
}

async function playFromList(page, name) {
  const target = card(page, name);
  await target.scrollIntoViewIfNeeded();
  await target.locator('.station-card__play').click();
  await expect(page.locator('#player-station')).toHaveText(name, { timeout: 15_000 });
}

test.describe('directory and playback selection', () => {
  test('station list renders the fixture directory', async ({ page }) => {
    await setupApp(page);
    for (const station of FIXTURE_STATIONS.slice(0, 3)) {
      await expect(card(page, station.name)).toBeVisible();
    }
  });

  test('selecting the same station twice is idempotent', async ({ page }) => {
    await setupApp(page);
    await playFromList(page, 'E2E Seoul Pop');
    const firstState = await page.locator('#player-station').textContent();

    await card(page, 'E2E Seoul Pop').locator('.station-card__play').click();
    await page.waitForTimeout(750);
    await expect(page.locator('#player-station')).toHaveText(firstState.trim());
    await expect(page.locator('.station-card--active')).toHaveCount(1);
    await expect(card(page, 'E2E Seoul Pop')).toHaveClass(/station-card--active/);
  });

  test('next then previous returns to the same station', async ({ page }) => {
    await setupApp(page);
    await playFromList(page, 'E2E Seoul Pop');

    await page.locator('#btn-next').click();
    await expect(page.locator('#player-station')).not.toHaveText('E2E Seoul Pop');
    const advanced = (await page.locator('#player-station').textContent()).trim();

    await page.locator('#btn-prev').click();
    await expect(page.locator('#player-station')).toHaveText('E2E Seoul Pop');

    // Round-trip again: same combination of actions must land on the same states.
    await page.locator('#btn-next').click();
    await expect(page.locator('#player-station')).toHaveText(advanced);
    await page.locator('#btn-prev').click();
    await expect(page.locator('#player-station')).toHaveText('E2E Seoul Pop');
  });

  test('favorite toggled twice returns to the original state', async ({ page }) => {
    await setupApp(page);
    await playFromList(page, 'E2E London Jazz');

    const favorite = page.locator('#btn-favorite');
    const initial = await favorite.getAttribute('aria-pressed');
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', initial === 'true' ? 'false' : 'true');
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', initial ?? 'false');
  });

  test('play/pause toggled repeatedly stays consistent', async ({ page }) => {
    await setupApp(page);
    await playFromList(page, 'E2E Berlin Techno');
    const playButton = page.locator('#btn-play');

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await playButton.click();
      await page.waitForTimeout(400);
      await playButton.click();
      await page.waitForTimeout(400);
    }
    await expect(page.locator('#player-station')).toHaveText('E2E Berlin Techno');
    await expect(page.locator('.station-card--active')).toHaveCount(1);
  });
});

test.describe('map progressive disclosure', () => {
  async function openMapMarkers(page) {
    const map = page.locator('#map');
    await expect(map).toBeVisible();
    // Zoom in enough that clusters break apart into individual station dots.
    const markers = page.locator('#map path.leaflet-interactive');
    for (let attempt = 0; attempt < 6 && (await markers.count()) < FIXTURE_STATIONS.length; attempt += 1) {
      const cluster = page.locator('#map .er-cluster').first();
      if (await cluster.count()) {
        await cluster.click();
        await page.waitForTimeout(700);
      } else {
        break;
      }
    }
    await expect(markers.first()).toBeVisible();
    return markers;
  }

  test('hovering a station dot discloses the station before selection', async ({ page }) => {
    await setupApp(page);
    const markers = await openMapMarkers(page);

    await markers.first().hover();
    const tooltip = page.locator('.er-station-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('.er-tt-name')).toHaveText(/E2E /);
    await expect(tooltip.locator('.er-tt-hint')).toHaveText(/click to listen/i);
    // Nothing has been selected by hover alone.
    await expect(page.locator('#player-station')).not.toHaveText(/E2E /);
  });

  test('clicking the hovered dot selects exactly the disclosed station', async ({ page }) => {
    await setupApp(page);
    const markers = await openMapMarkers(page);

    const marker = markers.first();
    await marker.hover();
    const tooltip = page.locator('.er-station-tooltip .er-tt-name');
    await expect(tooltip).toBeVisible();
    const disclosedName = (await tooltip.textContent()).trim();

    await marker.click();
    await expect(page.locator('#player-station')).toHaveText(disclosedName, { timeout: 15_000 });

    // Clicking the same dot again keeps the same state (idempotent selection).
    await marker.click({ force: true });
    await page.waitForTimeout(600);
    await expect(page.locator('#player-station')).toHaveText(disclosedName);
  });
});
