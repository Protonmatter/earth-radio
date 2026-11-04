import { test, expect } from '@playwright/test';
import { setupApp, playFromList } from './helpers.mjs';
import { EXPANSION_STATIONS } from './fixtures/stations.mjs';

test('inline discovery filters without autoplay, supports reset and survives repeated use', async ({ page }) => {
  await setupApp(page);
  const query = page.getByRole('searchbox', { name: 'Find a station' });
  await query.fill('london jazz');
  await expect(page.locator('.station-card')).toHaveCount(1);
  await expect(page.locator('.station-card__name')).toHaveText('E2E London Jazz');
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
  await query.fill('nothing-matches-this');
  await expect(page.locator('.station-card:visible')).toHaveCount(0);
  await expect(page.locator('#empty-state')).toBeVisible();
  await page.getByRole('button', { name: 'Reset discovery' }).click();
  await expect(page.locator('.station-card').first()).toBeVisible();
  await page.getByLabel('Genre', { exact: true }).selectOption('jazz');
  await expect(page.locator('.station-card__name')).toHaveText('E2E London Jazz');
});

test('vector atlas works without tile requests and area filtering is reversible', async ({ page }) => {
  const tiles = [];
  page.on('request', r => { if (/cartocdn|tile\.openstreetmap/.test(r.url())) tiles.push(r.url()); });
  await setupApp(page);
  await expect(page.locator('.er-vector-land').first()).toBeAttached();
  await expect.poll(() => page.locator('.er-vector-land').evaluateAll(paths => Math.max(...paths.map(path => path.getBoundingClientRect().width)))).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Search this area' }).click();
  await expect(page.getByRole('button', { name: 'Clear map area' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear map area' }).click();
  await page.getByRole('button', { name: 'Fit stations' }).click();
  expect(tiles).toEqual([]);
});

test('area search loads mapped stations outside the initial featured-country catalog', async ({ page }) => {
  const geoRequests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname.endsWith('api.radio-browser.info') && url.searchParams.get('has_geo_info') === 'true') geoRequests.push(url.href);
  });
  await setupApp(page);
  await page.goto('/#countries=Germany');
  await expect(page.locator('.station-card__name')).toHaveText('E2E Berlin Techno');
  await page.getByRole('searchbox', { name: 'Find a station' }).fill('rio samba');
  await expect(page.locator('#er-discovery-status')).toContainText('0 matches');
  await page.getByRole('button', { name: 'Search this area' }).click();
  await expect.poll(() => geoRequests.length).toBe(1);
  await expect(page.locator('.station-card__name')).toHaveText('E2E Rio Samba');
  await expect(page.locator('#er-map-count')).toContainText('1 located');
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
  await page.getByRole('button', { name: 'Search this area' }).click();
  await expect(page.getByRole('button', { name: 'Search this area' })).toBeEnabled();
  expect(geoRequests).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear map area' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear map area' }).click();
  await expect(page.getByRole('button', { name: 'Clear map area' })).not.toBeVisible();
});

test('failed map-directory loads show a retry and do not poison the next area search', async ({ page }) => {
  await setupApp(page);
  let fail = true, requests = 0;
  await page.route('**/json/stations/search?**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('has_geo_info') !== 'true') return route.fallback();
    requests++;
    return fail ? route.fulfill({ status: 503, body: 'fixture unavailable' }) : route.fallback();
  });
  await page.getByRole('searchbox', { name: 'Find a station' }).fill('rio samba');
  await expect(page.locator('#er-discovery-status')).toContainText('0 matches');
  await page.getByRole('button', { name: 'Search this area' }).click();
  await expect(page.locator('#er-map-directory-status')).toContainText('tap Search this area to retry');
  await expect(page.getByRole('button', { name: 'Search this area' })).toBeEnabled();
  expect(requests).toBe(2);
  fail = false;
  await page.getByRole('button', { name: 'Search this area' }).click();
  await expect(page.locator('.station-card__name')).toHaveText('E2E Rio Samba');
  await expect(page.locator('#er-map-directory-status')).toContainText('1 mapped station matches');
  expect(requests).toBe(3);
});

for (const mode of ['favorites', 'recent']) {
  test(`area search exits ${mode} mode and clears its active header toggle`, async ({ page }) => {
    await setupApp(page);
    const toggle = page.locator(`#${mode}-toggle`);
    await toggle.click();
    await expect(toggle).toHaveClass(/header-btn--active/);
    await page.getByRole('button', { name: 'Search this area' }).click();
    await expect(toggle).not.toHaveClass(/header-btn--active/);
    await expect(page.locator('#grid-title')).toHaveText('All Stations');
    await expect(page.locator('#station-grid .station-card').first()).toBeVisible();
  });
}

test('SDR mode never requests or adds the world radio directory', async ({ page }) => {
  const geoRequests = [];
  page.on('request', request => { if (new URL(request.url()).searchParams.get('has_geo_info') === 'true') geoRequests.push(request.url()); });
  await setupApp(page);
  await page.goto('/?domain=sdr');
  await expect(page.locator('#er-map-search')).toBeDisabled();
  await expect(page.locator('#station-grid .station-card')).toHaveCount(0);
  expect(geoRequests).toEqual([]);
});

test('malformed optional map metadata cannot discard valid neighbors or poison cached retries', async ({ page }) => {
  await setupApp(page);
  let requests = 0;
  await page.route('**/json/stations/search?**', route => {
    if (new URL(route.request().url()).searchParams.get('has_geo_info') !== 'true') return route.fallback();
    requests++;
    return route.fulfill({ json: [
      { ...EXPANSION_STATIONS[0], stationuuid: 'malformed-map-record', country: { toString: null } },
      EXPANSION_STATIONS.find(station => station.countrycode === 'BR')
    ] });
  });
  await page.getByRole('searchbox', { name: 'Find a station' }).fill('rio samba');
  await expect(page.locator('#er-discovery-status')).toContainText('0 matches');
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: 'Search this area' }).click();
    await expect(page.locator('#er-map-directory-status')).toContainText('1 mapped station matches');
    await expect(page.locator('.station-card__name')).toHaveText('E2E Rio Samba');
  }
  expect(requests).toBe(1);
});

test('ranking explanation has keyboard access and plays exactly the disclosed station', async ({ page }) => {
  await setupApp(page);
  await page.getByRole('searchbox', { name: 'Find a station' }).fill('london');
  await expect(page.locator('#er-discovery-status')).toContainText('1 matches');
  await page.getByRole('button', { name: 'Why this station: E2E London Jazz' }).click();
  const dialog = page.getByRole('dialog', { name: 'Station details' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveText('E2E London Jazz');
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
  await dialog.getByRole('button', { name: 'Close station details' }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Why this station: E2E London Jazz' }).click();
  await dialog.getByRole('button', { name: 'Play station', exact: true }).click();
  await expect(page.locator('#player-station')).toHaveText('E2E London Jazz');
  await expect(dialog).not.toBeVisible();
});

test('map focus tracks playback and mobile discovery has no horizontal overflow', async ({ page }) => {
  await setupApp(page);
  await playFromList(page, 'E2E London Jazz');
  await expect(page.getByRole('button', { name: 'Focus playing station' })).toBeEnabled();
  await page.getByRole('button', { name: 'Focus playing station' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Browse', exact: true }).last().click();
  await expect(page.getByRole('searchbox', { name: 'Find a station' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Similar to playing follows a new station without requiring another filter action', async ({ page }) => {
  await setupApp(page);
  await playFromList(page, 'E2E Seoul Pop');
  await expect(page.locator('option[value="similar"]')).toHaveJSProperty('disabled', false);
  await page.getByLabel('Selection method').selectOption('similar');
  await expect(page.locator('#er-discovery-status')).toContainText('Similar genres');
  await expect(page.locator('.station-card[data-uuid="e2e-seoul-0001"]')).toHaveCount(0);
  await playFromList(page, 'E2E HLS Source');
  await expect(page.locator('.station-card[data-uuid="e2e-hls-0009"]')).toHaveCount(0);
  await expect(page.locator('.station-card[data-uuid="e2e-hls-0010"]')).toHaveCount(0);
  await expect(page.locator('.station-card[data-uuid="e2e-seoul-0001"]')).toBeVisible();
});

test('Hide recent failures updates immediately after an unsuccessful playback attempt', async ({ page }) => {
  await page.addInitScript(() => { window.RADIO_CONFIG = { autoSkipOnPlaybackError: false }; });
  await setupApp(page);
  await page.getByRole('searchbox', { name: 'Find a station' }).fill('seoul pop');
  await page.getByRole('checkbox', { name: 'Hide recent failures' }).check();
  await expect(page.locator('#er-discovery-status')).toContainText('1 matches');
  await page.evaluate(() => { document.getElementById('audio-player').play = () => Promise.reject(new Error('fixture failure')); });
  await page.locator('.station-card__play').click();
  await expect(page.locator('#er-discovery-status')).toContainText('0 matches');
  await expect(page.locator('.station-card:visible')).toHaveCount(0);
});
