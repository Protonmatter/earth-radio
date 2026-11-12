import { test, expect } from '@playwright/test';
import { setupApp } from './helpers.mjs';
import { CATALOGS } from '../../site/i18n/index.js';
import { mkdir } from 'node:fs/promises';

async function openPassport(page) {
  await page.locator('.er-primary-nav [data-er-primary="library"]').click();
  await page.locator('#grid-panel [data-er-library-section="passport"]').click();
  await expect(page.locator('#er-passport')).toBeVisible();
}
async function seed(page) {
  await page.evaluate(async () => {
    const version = document.documentElement.dataset.appVersion;
    const store = (await import('/assets/passport-store.js?v=' + version)).passportStore();
    const core = await import('/assets/passport-core.js?v=' + version);
    const snapshot = await store.read();
    await store.mutate(doc => core.recordPassportPlace(core.recordPassportPlace(doc,
      { countrycode: 'DE', confidence: 'city', cityId: 'ne-1159151529', city: 'Berlin' }, 20_000),
      { countrycode: 'KR', confidence: 'country' }, 20_001), snapshot);
  });
}

test('Passport is an empty private Library view; browsing and favorites do not invent visits', async ({ page }) => {
  await setupApp(page);
  await page.locator('#er-discovery-query').fill('E2E Seoul Pop');
  const card = page.locator('.station-card').filter({ has: page.getByText('E2E Seoul Pop', { exact: true }) });
  await card.locator('.station-card__play').hover(); await card.locator('.station-card__favorite').click();
  await card.locator('.er-discovery-why').click();
  await page.locator('#er-station-detail [data-detail-close]').click();
  await openPassport(page);
  await expect(page.locator('#er-passport-empty')).toBeVisible();
  await expect(page.locator('#er-passport-countries')).toHaveText('0');
  await expect(page.locator('#er-passport-cities')).toHaveText('0');
  await expect(page.locator('.er-song-library')).toBeHidden();
  await expect(page.locator('#er-library-account-actions')).toBeHidden();
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
  await expect(page.locator('#er-passport-import')).toBeEnabled();
  await page.locator('#er-passport-history-settings').click();
  await expect(page.locator('#er-song-history-enabled')).toBeFocused();
});

for (const locale of ['en', 'es', 'ar', 'ko', 'zh-Hans', 'zh-Hant']) for (const palette of ['paper', 'night']) test(`Passport fits 320px in ${locale} ${palette} with named places and keyboard controls`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(({ locale, palette }) => localStorage.setItem('earthRadio.ui.v1', JSON.stringify({ locale, localeExplicit: true, palette })), { locale, palette });
  await setupApp(page); await seed(page); await openPassport(page);
  await expect(page.locator('#er-passport-title')).toHaveText(CATALOGS[locale]['passport.title']);
  // Node and WebKit may ship different CLDR default numbering systems for ar.
  // Both representations express the exact count; don't derive browser output
  // from the runner's independent ICU version or force Latin digits in the UI.
  await expect(page.locator('#er-passport-countries')).toHaveText(locale === 'ar' ? /^(?:2|٢)$/ : '2');
  await expect(page.locator('#er-passport-cities')).toHaveText(locale === 'ar' ? /^(?:1|١)$/ : '1');
  await expect(page.locator('#er-passport-list')).toContainText('Berlin');
  await expect(page.locator('#er-passport-list [data-passport-country]')).toHaveCount(2);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  const boxes = await page.locator('#er-you').evaluate(root => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    targets: [...root.querySelectorAll('.er-library-tabs button, #er-passport button, #er-passport .er-passport-import')]
      .filter(node => node.getBoundingClientRect().height).map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; })
  }));
  expect(boxes.overflow).toBeLessThanOrEqual(1);
  expect(boxes.targets.length).toBeGreaterThanOrEqual(9);
  for (const box of boxes.targets) { expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.left).toBeGreaterThanOrEqual(-1); expect(box.right).toBeLessThanOrEqual(321); }
  await mkdir('.build/evidence/passport', { recursive: true });
  await page.screenshot({ path: `.build/evidence/passport/${locale}-${palette}-320.png` });
  await page.locator('#er-passport-export').focus(); await expect(page.locator('#er-passport-export')).toBeFocused();
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
});

test('Passport history-off hides prior visits and Clear history removes them while preserving likes', async ({ page }) => {
  await setupApp(page); await seed(page); await openPassport(page);
  await page.evaluate(async () => {
    const version = document.documentElement.dataset.appVersion;
    const store = (await import('/assets/song-library-store.js?v=' + version)).songLibraryStore();
    const core = await import('/assets/song-library-core.js?v=' + version);
    await store.mutate(doc => core.setSongLiked(doc, { id: 'b'.repeat(64), title: 'Fixture liked song', artist: 'Fixture artist' }, true, 1000), (await store.read()).ownerVersion);
  });
  await expect(page.locator('#er-passport-countries')).toHaveText('2');
  await page.locator('#er-passport-history-settings').click();
  await page.locator('#er-song-history-enabled').uncheck();
  await expect(page.locator('#er-song-history-enabled')).toBeEnabled();
  await page.locator('#er-you [data-er-library-section="passport"]').click();
  await expect(page.locator('#er-passport-off')).toBeVisible();
  await expect(page.locator('#er-passport-list')).toBeEmpty();
  await expect(page.locator('#er-passport-import')).toBeDisabled();
  await expect(page.locator('#er-passport-clear')).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#er-passport-clear').click();
  await expect(page.locator('#er-passport-clear')).toBeEnabled();
  await page.locator('#er-passport-history-settings').click();
  await page.locator('#er-song-history-enabled').check();
  await expect(page.locator('#er-song-history-enabled')).toBeEnabled();
  await page.locator('#er-you [data-er-library-section="passport"]').click();
  await expect(page.locator('#er-passport-countries')).toHaveText('0');
  await expect(page.locator('#er-passport-empty')).toBeVisible();
  expect(await page.evaluate(async () => {
    const store = (await import('/assets/song-library-store.js?v=' + document.documentElement.dataset.appVersion)).songLibraryStore();
    return (await store.read()).value.tracks['b'.repeat(64)]?.liked;
  })).toBe(true);
});

for (const palette of ['paper', 'night']) test(`Passport shades actual countries in ${palette}, clears on privacy transitions and requests no extra detail layers`, async ({ page }) => {
  await page.addInitScript(palette => localStorage.setItem('earthRadio.ui.v1', JSON.stringify({ palette })), palette);
  const heavy = [];
  page.on('request', request => { if (/\/map-(?:world|detail|terrain|roads)-[a-f0-9]{8}\.js/.test(request.url())) heavy.push(request.url()); });
  await setupApp(page);
  await expect(page.locator('#map')).toHaveAttribute('data-er-map-detail', 'world');
  const initial = [...heavy]; await seed(page);
  const germany = page.locator('#map path[data-er-country="DE"]').first();
  const britain = page.locator('#map path[data-er-country="GB"]').first();
  await expect(germany).toHaveAttribute('data-er-passport-visited', 'true');
  await expect(britain).toHaveAttribute('data-er-passport-visited', 'false');
  expect(await germany.evaluate(node => getComputedStyle(node).fill)).not.toBe(await britain.evaluate(node => getComputedStyle(node).fill));
  await expect(page.locator('#map')).toHaveAttribute('data-er-passport-countries', 'DE,KR');
  await page.locator('#settings-toggle').click();
  await page.locator('#er-settings-preferences').getByRole('button', { name: palette === 'paper' ? 'Night' : 'Paper', exact: true }).click();
  await page.locator('#settings-modal .settings-header [data-close-settings]').click();
  await expect(page.locator('#map')).toHaveAttribute('data-er-basemap', palette === 'paper' ? 'dark' : 'light');
  await expect(germany).toHaveAttribute('data-er-passport-visited', 'true');
  expect(await germany.evaluate(node => getComputedStyle(node).fill)).not.toBe(await britain.evaluate(node => getComputedStyle(node).fill));
  await page.evaluate(async () => {
    const version = document.documentElement.dataset.appVersion;
    const store = (await import('/assets/song-library-store.js?v=' + version)).songLibraryStore();
    const core = await import('/assets/song-library-core.js?v=' + version);
    await store.mutate(doc => core.setSongHistoryEnabled(doc, false), (await store.read()).ownerVersion);
  });
  await expect(germany).toHaveAttribute('data-er-passport-visited', 'false');
  expect(await germany.evaluate(node => getComputedStyle(node).fill)).toBe(await britain.evaluate(node => getComputedStyle(node).fill));
  await page.evaluate(async () => {
    const version = document.documentElement.dataset.appVersion;
    const store = (await import('/assets/song-library-store.js?v=' + version)).songLibraryStore();
    const core = await import('/assets/song-library-core.js?v=' + version);
    await store.mutate(doc => core.setSongHistoryEnabled(doc, true), (await store.read()).ownerVersion);
  });
  await expect(germany).toHaveAttribute('data-er-passport-visited', 'true');
  await page.evaluate(async () => {
    const version = document.documentElement.dataset.appVersion;
    const store = (await import('/assets/song-library-store.js?v=' + version)).songLibraryStore();
    const core = await import('/assets/song-library-core.js?v=' + version);
    await store.mutate(doc => core.clearSongHistory(doc, 1000), (await store.read()).ownerVersion);
  });
  await expect(germany).toHaveAttribute('data-er-passport-visited', 'false');
  await seed(page); await expect(germany).toHaveAttribute('data-er-passport-visited', 'true');
  const immediate = await page.evaluate(async () => {
    const store = await import('/assets/song-library-store.js?v=' + document.documentElement.dataset.appVersion);
    store.pauseSongLibraryAccount();
    return { countries: document.getElementById('map').dataset.erPassportCountries,
      marked: document.querySelectorAll('#map [data-er-passport-visited="true"]').length };
  });
  expect(immediate).toEqual({ countries: '', marked: 0 });
  expect(heavy).toEqual(initial);
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
});
