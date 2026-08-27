// End-to-end UI tests for the recovered Earth Radio site.
// Focus: idempotency of repeated user actions and progressive disclosure on the map.
// All external traffic is intercepted, so runs are hermetic and deterministic.

import { expect, test } from '@playwright/test';
import { FIXTURE_STATIONS } from './fixtures/stations.mjs';
import { card, playFromList, setupApp } from './helpers.mjs';

test.describe('directory and playback selection', () => {
  test('station list renders the fixture directory', async ({ page }) => {
    await setupApp(page);
    for (const station of FIXTURE_STATIONS.slice(0, 3)) {
      await expect(card(page, station.name)).toBeVisible();
    }
  });

  test('LISTEN.moe is present without expanding Japan', async ({ page }) => {
    await setupApp(page);
    await expect(card(page, 'LISTEN.moe')).toBeVisible();
    await expect(card(page, 'LISTEN.moe Kpop')).toBeVisible();
    await playFromList(page, 'LISTEN.moe');
    await expect(page.locator('#player-station')).toHaveText('LISTEN.moe');
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
    const paused = () => page.evaluate(() => document.getElementById('audio-player')?.paused ?? true);

    await page.waitForFunction(() => document.getElementById('audio-player')?.paused === false);
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await playButton.click();
      await expect.poll(paused, { timeout: 5000 }).toBe(true);
      await playButton.click();
      await expect.poll(paused, { timeout: 5000 }).toBe(false);
    }
    await expect(page.locator('#player-station')).toHaveText('E2E Berlin Techno');
    await expect(page.locator('.station-card--active')).toHaveCount(1);
  });
});

test.describe('map progressive disclosure', () => {
  async function openMapMarkers(page) {
    const map = page.locator('#map');
    await expect(map).toBeVisible();
    // Zoom in until clusters break apart into individual station dots.
    // :visible filters out zero-size placeholder paths markercluster leaves in the pane.
    const markers = page.locator('#map path.leaflet-interactive:visible');
    for (let attempt = 0; attempt < 6 && (await markers.count()) < FIXTURE_STATIONS.length; attempt += 1) {
      const cluster = page.locator('#map .er-cluster').first();
      if (!(await cluster.count())) break;
      const before = await markers.count();
      await cluster.click();
      // Wait for the zoom animation to actually change the marker/cluster layout.
      await page.waitForFunction(
        previous => document.querySelectorAll('#map path.leaflet-interactive').length !== previous,
        before,
        { timeout: 5000 }
      ).catch(() => {});
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
