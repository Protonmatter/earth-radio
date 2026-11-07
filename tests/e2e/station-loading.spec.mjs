import { test, expect } from '@playwright/test';
import { setupApp } from './helpers.mjs';
import { FIXTURE_STATIONS } from './fixtures/stations.mjs';

test('large directory supports offscreen discovery, end-of-list selection and cached reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupApp(page);
  const stations = Array.from({ length: 500 }, (_, index) => ({
    ...FIXTURE_STATIONS[0], stationuuid: `bulk-fixture-${index}`,
    name: index === 499 ? 'Zzyzx Deepwater Finale' : `Bulk Signal ${String(index).padStart(3, '0')}`,
    url: `https://streams.e2e.example/bulk-${index}.mp3`,
    url_resolved: `https://streams.e2e.example/bulk-${index}.mp3`,
    country: 'United States', countrycode: 'US', tags: 'regression,music',
    geo_lat: 20 + index % 40, geo_long: -120 + index % 60,
    votes: 100, clickcount: 500 - index
  }));
  let offline = false;
  await page.route('**/json/stations/topclick/**', route => offline
    ? route.abort('failed') : route.fulfill({ json: stations }));
  // Explicit refresh exercises the network path rather than the existing cache.
  await page.locator('#er-overflow-toggle').click();
  await page.locator('#er-overflow [data-click-id="refresh-stations"]').click();
  await expect(page.locator('#grid-count')).toContainText(/50\d stations/);
  await expect(page.locator('.station-card[data-uuid="bulk-fixture-499"]')).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Find a station' });
  await search.fill('Deepwater Finale');
  await expect(page.locator('.station-card__name')).toHaveText(['Zzyzx Deepwater Finale']);
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.locator('.station-card__name')).toHaveText(['Zzyzx Deepwater Finale']);
  await search.fill('NoSuchFrequency9821');
  await expect(page.locator('#er-discovery-status')).toContainText('0 matches');
  await page.getByRole('button', { name: 'Reset discovery' }).click();
  await expect(page.locator('#grid-count')).toContainText(/50\d stations/);
  await page.getByLabel('Selection method').selectOption('name');
  await expect.poll(async () => {
    await page.locator('#station-grid').evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
    return page.locator('.station-card[data-uuid="bulk-fixture-499"]').count();
  }).toBe(1);
  await expect(page.locator('.station-card[data-uuid="bulk-fixture-499"]')).toBeVisible();
  await page.locator('.station-card[data-uuid="bulk-fixture-499"] .station-card__play').click();
  await expect(page.locator('#player-station')).toHaveText('Zzyzx Deepwater Finale');
  await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  // A fresh document must recover the directory even with its source unavailable.
  offline = true;
  await page.reload();
  await expect(page.locator('.station-card').first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a station' }).fill('Deepwater Finale');
  await expect(page.locator('.station-card__name')).toHaveText(['Zzyzx Deepwater Finale']);
});
