import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { setupApp } from './helpers.mjs';

for (const size of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) {
  test(`listening room keeps compact rows actionable at ${size.width}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await setupApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-er-palette', 'paper');
    await expect(page.locator('#grid-title')).toHaveText('Stations');
    await expect(page.locator('.er-atlas-caption strong')).not.toBeVisible();
    const geometry = await page.locator('.station-card').evaluateAll(cards => cards.slice(0, 5).map(card => {
      const box = card.getBoundingClientRect();
      return { left: box.left, top: box.top, bottom: box.bottom, height: box.height,
        controls: [...card.querySelectorAll('.station-card__play, .station-card__favorite')].map(button => {
          const r = button.getBoundingClientRect();
          return { width: r.width, height: r.height, within: r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom };
        }) };
    }));
    expect(geometry.length).toBeGreaterThan(2);
    for (const [index, row] of geometry.entries()) {
      expect(row.height).toBe(76);
      expect(row.left).toBe(geometry[0].left);
      if (index) expect(row.top).toBeGreaterThanOrEqual(geometry[index - 1].bottom);
      for (const control of row.controls) {
        expect(control.width).toBeGreaterThanOrEqual(44);
        expect(control.height).toBeGreaterThanOrEqual(44);
        expect(control.within).toBe(true);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    // Quick picks keep their original runtime handlers in the existing overflow menu.
    await page.locator('#er-overflow-toggle').click();
    await expect(page.locator('#daily-dashboard')).toBeVisible();
    await expect(page.locator('[data-dashboard-action="world-scan"]')).toBeVisible();
    await page.locator('[data-dashboard-action="world-scan"]').click();
    await expect(page.locator('#er-overflow')).not.toBeVisible();
    await expect(page.locator('#player-station')).not.toHaveText('Select a station');
    // Narrow through the supported search UI before selecting again: quick-pick
    // health updates can legitimately replace virtual nodes as playback settles.
    await page.locator('#er-discovery-query').fill('Berlin');
    await expect(page.locator('.station-card__name')).toHaveText(['E2E Berlin Techno']);
    await page.locator('.station-card__play').click();
    await expect(page.locator('#player-station')).toHaveText('E2E Berlin Techno');
    await page.getByRole('button', { name: 'Reset discovery', exact: true }).click();
    await page.locator('.station-card--active .er-discovery-why').click();
    await expect(page.locator('#er-station-detail')).toBeVisible();
    await page.keyboard.press('Escape');
    await mkdir('.build/evidence/listening-room', { recursive: true });
    await page.screenshot({ path: `.build/evidence/listening-room/${size.width}.png` });
  });
}

test('saved Night remains available after reload and returns to Paper', async ({ page }) => {
  await setupApp(page);
  await page.locator('header [data-er-dest="you"]').click();
  await page.getByRole('button', { name: 'Night', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-er-palette', 'night');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-er-palette', 'night');
  await page.getByRole('button', { name: 'Paper', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-er-palette', 'paper');
});
