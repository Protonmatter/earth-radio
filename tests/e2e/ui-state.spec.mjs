// UI state regressions: locale previews hold until Save or Cancel (the document
// observer must honor the active preview, not revert it), and cancelling reverts.

import { expect, test } from '@playwright/test';
import { setupApp } from './helpers.mjs';

test('an Arabic locale preview keeps lang/dir until the settings dialog closes', async ({ page }) => {
  await setupApp(page);

  // Open the settings surface and preview Arabic without saving.
  await page.evaluate(() => {
    const modal = document.getElementById('settings-modal');
    modal.removeAttribute('hidden');
    modal.style.display = '';
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

  // Cancelling (closing without Save) reverts to the persisted locale.
  await page.evaluate(() => {
    const modal = document.getElementById('settings-modal');
    modal.setAttribute('hidden', '');
    modal.style.display = 'none';
  });
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // And the preview does not persist across a reload.
  await page.reload();
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
