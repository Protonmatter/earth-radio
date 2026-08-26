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

  test('prefs-only recovery reloads away stale rendered and in-memory favorites', async ({ page }) => {
    await setupApp(page);
    await playFromList(page, 'E2E Seoul Pop');
    await page.locator('#btn-favorite').click();
    await expect(page.locator('#btn-favorite')).toHaveAttribute('aria-pressed', 'true');

    // Leave the stale favorite in both IndexedDB and this page's hydrated memory, but
    // make a prefs-only v2 backup authoritative by removing the primary marker.
    await page.evaluate(async () => {
      const data = { prefs: { theme: 'light' } };
      const payload = JSON.stringify(data);
      const envelope = {
        v: 2,
        namespace: 'default',
        generation: 41,
        savedAt: 4100,
        checksum: '',
        payload
      };
      const representation = JSON.stringify([
        envelope.v, envelope.namespace, envelope.generation, envelope.savedAt, envelope.payload
      ]);
      let hash = 0x811c9dc5;
      for (let index = 0; index < representation.length; index += 1) {
        hash ^= representation.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      envelope.checksum = (hash >>> 0).toString(16);
      localStorage.setItem('earth-radio-user-backup-v2:default:current', JSON.stringify(envelope));
      localStorage.removeItem('earth-radio-user-backup-v2:default:previous');
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('earthRadio', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction('kv', 'readwrite');
          transaction.objectStore('kv').delete('earth-radio-storage-generation-v2');
          transaction.oncomplete = () => { request.result.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        };
      });
    });

    // The first boot commits the deterministic restore and must force a second boot
    // before the app can continue with the stale hydrated favorite.
    await page.reload();
    await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 25_000 });
    await expect(card(page, 'E2E Seoul Pop').locator('.station-card__favorite--active')).toHaveCount(0);
    await page.waitForFunction(() => Boolean(window.earthRadioStorageGuard));
    await page.evaluate(() => window.earthRadioStorageGuard.snapshotNow());

    const recovered = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('earthRadio', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('kv', 'readonly');
        const store = transaction.objectStore('kv');
        const favorites = store.get('favorites');
        const prefs = store.get('prefs');
        transaction.oncomplete = () => {
          const raw = localStorage.getItem('earth-radio-user-backup-v2:default:current');
          request.result.close();
          resolve({ favorites: favorites.result, prefs: prefs.result, backup: JSON.parse(raw).payload });
        };
        transaction.onerror = () => reject(transaction.error);
      };
    }));
    expect(recovered.favorites).toEqual({});
    expect(recovered.prefs.theme).toBe('light');
    expect(JSON.parse(recovered.backup).favorites).toEqual({});
  });
});

test.describe('semantic country selection', () => {
  test('the country-selected event expands coverage for keyboard and pointer alike', async ({ page }) => {
    await setupApp(page);
    await expect(card(page, 'E2E Tokyo FM')).toHaveCount(0);
    await page.waitForFunction(() => Boolean(window.earthRadioDirectory));

    const countries = [];
    await page.exposeFunction('recordCountrySelection', detail => countries.push(detail));
    await page.evaluate(() => {
      document.addEventListener('earthradio:country-selected', event => {
        window.recordCountrySelection(event.detail);
      });
    });
    await page.locator('[data-er-open-search]').click();
    const country = page.locator('#er-country-query');
    await country.fill('Japan');
    await country.press('Enter');

    await expect.poll(() => countries).toEqual([{ country: 'Japan' }]);
    await expect(card(page, 'E2E Tokyo FM')).toBeVisible({ timeout: 20_000 });
  });

  test('rapid expansions of different countries coalesce into a complete final set', async ({ page }) => {
    await setupApp(page);
    await page.waitForFunction(() => Boolean(window.earthRadioDirectory));

    await page.evaluate(() => {
      const nativeFetch = window.fetch.bind(window);
      const nativeSetTimeout = window.setTimeout.bind(window);
      let delayedJapan = false;
      window.__erDirectoryCycles = { active: 0, peak: 0, requests: [], results: [] };
      window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
        callback,
        Number(delay) === 12000 ? 80 : delay,
        ...args
      );
      window.fetch = async (input, init) => {
        const href = typeof input === 'string' ? input : input.url;
        const url = new URL(href, location.href);
        if (!delayedJapan
          && url.hostname.endsWith('api.radio-browser.info')
          && url.pathname.includes('/json/stations/search')
          && url.searchParams.get('countrycode')?.toUpperCase() === 'JP') {
          delayedJapan = true;
          await new Promise(resolve => nativeSetTimeout(resolve, 450));
        }
        return nativeFetch(input, init);
      };
      // The expansion overlay drives refreshes through the runtime's
      // earthRadioRuntime.refreshStations() hook (not the DOM button), so cycle
      // accounting wraps that hook. The runtime freezes the object; replacing the
      // window property with a wrapped copy is the supported observation seam.
      const nativeRuntime = window.earthRadioRuntime;
      const nativeRefresh = nativeRuntime.refreshStations;
      window.earthRadioRuntime = Object.freeze({
        ...nativeRuntime,
        refreshStations: async (...args) => {
          const cycles = window.__erDirectoryCycles;
          cycles.active += 1;
          cycles.peak = Math.max(cycles.peak, cycles.active);
          cycles.requests.push([...window.RADIO_CONFIG.featuredCountryCodes]);
          try {
            return await nativeRefresh.apply(nativeRuntime, args);
          } finally {
            cycles.active -= 1;
            cycles.results.push([...document.querySelectorAll('.station-card__name')]
              .map(node => node.textContent?.trim() || ''));
          }
        }
      });
    });

    // Japan then Brazil back-to-back: the serialized scheduler queues the second
    // refresh, which re-reads the merged code set, so the final state has both.
    const results = await page.evaluate(async () => Promise.all([
      window.earthRadioDirectory.expand('Japan'),
      window.earthRadioDirectory.expand('Brazil')
    ]));
    expect(results.filter(item => item.expanded).length).toBe(2);

    await page.waitForFunction(() => window.__erDirectoryCycles.results.length === 2);
    await expect(card(page, 'E2E Tokyo FM')).toBeVisible({ timeout: 30_000 });
    await expect(card(page, 'E2E Rio Samba')).toBeVisible({ timeout: 30_000 });
    const state = await page.evaluate(() => ({
      activeCodes: window.earthRadioDirectory.activeCodes(),
      cycles: window.__erDirectoryCycles
    }));
    expect(state.activeCodes).toContain('JP');
    expect(state.activeCodes).toContain('BR');
    expect(state.cycles.peak).toBe(1);
    expect(state.cycles.requests).toHaveLength(2);
    expect(state.cycles.requests.at(-1)).toEqual(expect.arrayContaining(['JP', 'BR']));
    expect(state.cycles.results.at(-1)).toEqual(expect.arrayContaining(['E2E Tokyo FM', 'E2E Rio Samba']));
  });
});

test.describe('account-scoped backup identity', () => {
  test('a backup captured under another account never restores into this namespace', async ({ page }) => {
    await setupApp(page);
    await playFromList(page, 'E2E Berlin Techno');
    await page.locator('#btn-favorite').click();
    await page.waitForFunction(() => Boolean(window.earthRadioStorageGuard));
    await page.evaluate(() => window.earthRadioStorageGuard.snapshotNow());
    await page.waitForFunction(() => window.earthRadioStorageGuard.status().hasBackup);

    // Re-label the backup as belonging to a different account, then lose the store.
    await page.evaluate(() => {
      const key = 'earth-radio-user-backup-v2:default:current';
      const previousKey = 'earth-radio-user-backup-v2:default:previous';
      const raw = localStorage.getItem(key);
      const parsed = JSON.parse(raw);
      parsed.namespace = 'account:someone-else';
      localStorage.setItem(key, raw && JSON.stringify(parsed));
      localStorage.removeItem(previousKey);
      return new Promise(resolve => {
        const open = indexedDB.open('earthRadio', 1);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').clear();
          tx.oncomplete = () => { open.result.close(); resolve(true); };
          tx.onabort = () => resolve(false);
        };
        open.onerror = () => resolve(false);
      });
    });

    await page.reload();
    await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    // The foreign-namespace backup must be rejected: nothing restored.
    await expect(card(page, 'E2E Berlin Techno').locator('.station-card__favorite--active')).toHaveCount(0);
  });
});
