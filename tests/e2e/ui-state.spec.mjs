// UI state regressions: locale previews hold until Save or Cancel (the document
// observer must honor the active preview, not revert it), and cancelling reverts.

import { expect, test } from '@playwright/test';
import { setupApp } from './helpers.mjs';

test('an Arabic locale preview keeps lang/dir until the settings dialog closes', async ({ page }) => {
  await setupApp(page);

  // Open the settings surface exactly the way the runtime does (hidden, display,
  // AND aria-hidden). The open must settle before the user's locale change: the
  // visibility tracker clears stale previews on the open transition.
  await page.evaluate(() => {
    const modal = document.getElementById('settings-modal');
    modal.hidden = false;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  });
  await page.waitForTimeout(50);
  // Preview Arabic without saving.
  await page.evaluate(() => {
    const select = document.getElementById('setting-locale');
    select.value = 'ar';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  // The mutation observer must not revert the preview while the dialog stays open.
  await page.waitForTimeout(800);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

  // Cancelling (closing without Save) reverts to the persisted locale; the close
  // mirrors the runtime's own close path.
  await page.evaluate(() => {
    const modal = document.getElementById('settings-modal');
    modal.hidden = true;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  });
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // And the preview does not persist across a reload.
  await page.reload();
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('narrowing the window re-clamps the saved split to the live workspace', async ({ page }) => {
  await setupApp(page);

  // Persist a split that is legal against the saved viewport width but exceeds what
  // the live workspace (which is narrower than the viewport) allows for the map's
  // 360px minimum.
  await page.evaluate(() => {
    localStorage.setItem('earthRadio.ui.v1', JSON.stringify({ split: 72, viewportWidth: 1360 }));
  });
  await page.reload();
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20_000 });

  const readClamp = () => page.evaluate(async () => {
    const ui = await import('/assets/responsive-ui.js');
    const width = document.querySelector('main.main').getBoundingClientRect().width;
    return {
      pct: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--er-list-pct')),
      max: ui.splitBounds(width).max
    };
  });

  // clampSplitPercent rounds to 0.1 while splitBounds rounds to integers: allow 0.6.
  await expect.poll(async () => {
    const { pct, max } = await readClamp();
    return pct <= max + 0.6;
  }, { timeout: 10_000, message: 'the saved split must be re-clamped against the live workspace' }).toBe(true);
  const widePct = (await readClamp()).pct;

  // Still desktop mode (>1099px), but the workspace is now narrower again: the split
  // must follow it down instead of pinning the map below its pixel minimum.
  await page.setViewportSize({ width: 1120, height: 850 });
  await expect.poll(async () => {
    const { pct, max } = await readClamp();
    return pct <= max + 0.6 && pct < widePct;
  }, { timeout: 10_000, message: 'the split must re-clamp after the window narrows' }).toBe(true);
});
