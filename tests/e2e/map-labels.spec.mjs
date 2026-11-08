import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { setupApp } from './helpers.mjs';

test('bundled geography shows country/city labels, independent toggles and remembered preferences', async ({ page }) => {
  const providers = [];
  page.on('request', request => { if (/cartocdn|tile\.openstreetmap|tiles\.openfreemap|mapbox/i.test(request.url())) providers.push(request.url()); });
  await setupApp(page);
  await expect.poll(() => page.locator('.er-geo-country').count(), { timeout: 15000 }).toBeGreaterThan(0);
  await expect(page.locator('#map')).toHaveAttribute('data-er-map-detail', 'world');
  await page.locator('#er-map-options summary').click();
  await page.getByLabel('Country names', { exact: true }).uncheck();
  await expect(page.locator('.er-geo-country')).toHaveCount(0);
  await expect(page.getByLabel('City names', { exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('#er-map-options')).not.toHaveAttribute('open', '');
  await page.getByRole('searchbox', { name: 'Find a station' }).fill('london jazz');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E London Jazz']);
  await page.getByRole('button', { name: 'Fit stations', exact: true }).click();
  await expect(page.locator('#map')).toHaveAttribute('data-er-map-detail', 'detail', { timeout: 20000 });
  await expect(page.locator('.er-geo-city').filter({ hasText: 'London' }).first()).toBeVisible();
  const canvas = page.locator('#map canvas');
  await expect(canvas).toBeVisible();
  const size = await canvas.evaluate(e => { const r=e.getBoundingClientRect(); return { width:r.width, height:r.height, expectedWidth:parseFloat(e.style.width) }; });
  expect(size.width).toBeGreaterThan(200);
  expect(Math.abs(size.width-size.expectedWidth)).toBeLessThan(2);
  expect(size.height).toBeGreaterThan(200);
  const labels = await page.locator('.er-geo-label').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }));
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i], b = labels[j];
    expect(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top).toBe(false);
  }
  await page.locator('#er-map-options summary').click();
  await page.getByLabel('City names', { exact: true }).uncheck();
  await expect(page.locator('.er-geo-city')).toHaveCount(0);
  await page.reload();
  await page.locator('#er-map-options summary').click();
  await expect(page.getByLabel('Country names', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('City names', { exact: true })).not.toBeChecked();
  await page.getByLabel('Country names', { exact: true }).check();
  await expect.poll(() => page.locator('.er-geo-country').count()).toBeGreaterThan(0);
  expect(providers).toEqual([]);
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
});

test('geographic labels and detail survive theme changes and phone layout', async ({ page }) => {
  await setupApp(page);
  await page.getByRole('searchbox', { name: 'Find a station' }).fill('london jazz');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E London Jazz']);
  await page.getByRole('button', { name: 'Fit stations', exact: true }).click();
  await expect(page.locator('.er-geo-city').filter({ hasText: 'London' }).first()).toBeVisible({ timeout: 20000 });
  await page.locator('#theme-toggle').click();
  await expect(page.locator('#map')).toHaveAttribute('data-er-basemap', 'dark');
  await expect(page.locator('.er-geo-city').filter({ hasText: 'London' }).first()).toBeVisible();
  await expect.poll(() => page.locator('#map canvas').count()).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Map', exact: true }).last().click();
  await page.locator('#er-map-options summary').click();
  await expect(page.getByLabel('Country names', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await mkdir('.build/evidence/geographic-atlas', { recursive: true });
  await page.screenshot({ path: '.build/evidence/geographic-atlas/london-phone-night.png' });
});

test('missing map detail keeps a usable fallback and does not block station discovery', async ({ page }) => {
  await setupApp(page);
  await page.route('**/assets/map-world*.js', route => route.abort('failed'));
  await page.reload();
  await expect(page.locator('#er-map-data-status')).toContainText('Map detail unavailable');
  await expect(page.locator('.er-vector-land').first()).toBeAttached();
  await page.getByRole('searchbox', { name: 'Find a station' }).fill('london jazz');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E London Jazz']);
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
});
