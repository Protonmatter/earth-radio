// Reliability specs: user-level persistence (favorites survive reloads and storage
// loss via the storage-guard backup) and dynamic per-country directory expansion.

import { expect, test } from '@playwright/test';
import { card, playFromList, setupApp } from './helpers.mjs';

test.describe('user data reliability', () => {
  test('favorites persist across a reload', async ({ page }) => {
    await setupApp(page);
    await playFromList(page, 'E2E Seoul Pop');

    const favorite = page.locator('#btn-favorite');
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20_000 });
    await expect(card(page, 'E2E Seoul Pop').locator('.station-card__favorite--active')).toBeVisible();
  });

  test('favorites survive complete loss of the primary store via the backup', async ({ page }) => {
    await setupApp(page);
    await playFromList(page, 'E2E London Jazz');
    await page.locator('#btn-favorite').click();
    await expect(page.locator('#btn-favorite')).toHaveAttribute('aria-pressed', 'true');

    // Force a guard snapshot so the localStorage backup definitely holds the favorite.
    await page.waitForFunction(() => Boolean(window.earthRadioStorageGuard));
    await page.evaluate(() => window.earthRadioStorageGuard.snapshotNow());
    await page.waitForFunction(() => window.earthRadioStorageGuard.status().hasBackup);

    // Simulate storage loss: wipe every user record from the kv store.
    await page.evaluate(() => new Promise(resolve => {
      const open = indexedDB.open('earthRadio', 1);
      open.onsuccess = () => {
        const tx = open.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').clear();
        tx.oncomplete = () => { open.result.close(); resolve(true); };
        tx.onabort = () => resolve(false);
      };
      open.onerror = () => resolve(false);
    }));

    // On the next boot the guard restores from backup (and reloads itself once).
    await page.reload();
    await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 25_000 });
    await expect(card(page, 'E2E London Jazz').locator('.station-card__favorite--active')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('dynamic directory expansion', () => {
  test('selecting a new country loads its stations on demand and persists', async ({ page }) => {
    await setupApp(page);

    // Japan is not part of the initial featured set: no Tokyo station yet.
    await expect(card(page, 'E2E Tokyo FM')).toHaveCount(0);

    await page.waitForFunction(() => Boolean(window.earthRadioDirectory));
    const result = await page.evaluate(() => window.earthRadioDirectory.expand('Japan'));
    expect(result.expanded).toBe(true);
    expect(result.code).toBe('JP');

    // The refresh pulls the JP country batch and the new stations appear.
    await expect(card(page, 'E2E Tokyo FM')).toBeVisible({ timeout: 20_000 });
    const codes = await page.evaluate(() => window.earthRadioDirectory.activeCodes());
    expect(codes).toContain('JP');

    // Expansion persists: after a reload the config keeps JP and the station is present.
    await page.reload();
    await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20_000 });
    const persisted = await page.evaluate(() => window.earthRadioDirectory.activeCodes());
    expect(persisted).toContain('JP');
    await expect(card(page, 'E2E Tokyo FM')).toBeVisible({ timeout: 20_000 });

    // Idempotent: expanding the same country again is a no-op, not a second refresh.
    const again = await page.evaluate(() => window.earthRadioDirectory.expand('Japan'));
    expect(again.expanded).toBe(false);
    expect(again.reason).toBe('already covered');
  });

  test('an unknown country never breaks the app', async ({ page }) => {
    await setupApp(page);
    await page.waitForFunction(() => Boolean(window.earthRadioDirectory));
    const result = await page.evaluate(() => window.earthRadioDirectory.expand('Atlantis'));
    expect(result.expanded).toBe(false);
    await expect(page.locator('.station-card').first()).toBeVisible();
  });
});

test.describe('storage intent semantics', () => {
  test('intentionally clearing the last favorite stays cleared after reload', async ({ page }) => {
    await setupApp(page);
    await playFromList(page, 'E2E Paris Chanson');
    const favorite = page.locator('#btn-favorite');
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');

    // Snapshot so the backup definitely contains the favorite (the stale state a
    // naive restore would resurrect).
    await page.waitForFunction(() => Boolean(window.earthRadioStorageGuard));
    await page.evaluate(() => window.earthRadioStorageGuard.snapshotNow());
    await page.waitForFunction(() => window.earthRadioStorageGuard.status().hasBackup);

    // Intentional deletion, then an immediate reload — before any further snapshot.
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(400);
    await page.reload();
    await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20_000 });

    // The valid generation marker proves the empty state is intentional: no restore.
    await page.waitForTimeout(1200);
    await expect(card(page, 'E2E Paris Chanson').locator('.station-card__favorite--active')).toHaveCount(0);
  });
});

test.describe('semantic country selection', () => {
  test('the country-selected event expands coverage for keyboard and pointer alike', async ({ page }) => {
    await setupApp(page);
    await expect(card(page, 'E2E Tokyo FM')).toHaveCount(0);
    await page.waitForFunction(() => Boolean(window.earthRadioDirectory));

    // The picker emits this one semantic event for mouse clicks, Enter-key selection,
    // and programmatic selection; expansion listens to the event, not to DOM clicks.
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('earthradio:country-selected', { detail: { country: 'Japan' } }));
    });
    await expect(card(page, 'E2E Tokyo FM')).toBeVisible({ timeout: 20_000 });
  });

  test('rapid expansions of different countries coalesce into a complete final set', async ({ page }) => {
    await setupApp(page);
    await page.waitForFunction(() => Boolean(window.earthRadioDirectory));

    // Japan then Brazil back-to-back: the serialized scheduler queues the second
    // refresh, which re-reads the merged code set, so the final state has both.
    const results = await page.evaluate(async () => Promise.all([
      window.earthRadioDirectory.expand('Japan'),
      window.earthRadioDirectory.expand('Brazil')
    ]));
    expect(results.filter(item => item.expanded).length).toBe(2);

    await expect(card(page, 'E2E Tokyo FM')).toBeVisible({ timeout: 30_000 });
    await expect(card(page, 'E2E Rio Samba')).toBeVisible({ timeout: 30_000 });
    const codes = await page.evaluate(() => window.earthRadioDirectory.activeCodes());
    expect(codes).toContain('JP');
    expect(codes).toContain('BR');
  });
});
