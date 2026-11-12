import { test, expect } from '@playwright/test';
import { setupApp, silentWav } from './helpers.mjs';
import { readFile } from 'node:fs/promises';

async function openPassport(page) {
  await page.locator('.er-primary-nav [data-er-primary="library"]').click();
  const first = page.locator('#grid-panel [data-er-library-section="passport"]');
  if (await first.isVisible()) await first.click();
  else await page.locator('#er-you [data-er-library-section="passport"]').click();
  await expect(page.locator('#er-passport')).toBeVisible();
}
const passport = page => page.evaluate(async () => (await (await import('/assets/passport-store.js?v=' + document.documentElement.dataset.appVersion)).passportStore().read()).value);
const kv = (page, key) => page.evaluate(key => new Promise((resolve, reject) => {
  const open = indexedDB.open('earthRadio', 1);
  open.onerror = () => reject(Error('Fixture read failed'));
  open.onsuccess = () => { const db = open.result, tx = db.transaction('kv'), read = tx.objectStore('kv').get(key);
    tx.oncomplete = () => { db.close(); resolve(read.result); }; tx.onabort = () => { db.close(); reject(Error('Fixture read failed')); }; };
}), key);
async function importSettings(page, value, name = 'earth-radio-fixture.json') {
  await page.locator('#settings-toggle').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#settings-modal [data-click-id="import-data"]').click();
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}

test('actual advancing media earns a place only after a continuous minute following pause; Clear removes the visit', async ({ page }) => {
  test.setTimeout(100_000);
  await setupApp(page);
  await page.route('https://streams.e2e.example/seoul.mp3', route => route.fulfill({ contentType: 'audio/wav', body: silentWav(120) }));
  await page.locator('#er-discovery-query').fill('E2E Seoul Pop');
  await page.getByRole('button', { name: 'Play: E2E Seoul Pop', exact: true }).click();
  await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  await expect.poll(() => page.locator('#audio-player').evaluate(audio => audio.currentTime), { timeout: 6000, intervals: [200] }).toBeGreaterThan(3);
  await page.locator('#btn-play').click();
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
  expect((await passport(page))?.countries || {}).toEqual({});
  await page.locator('#btn-play').click();
  await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  const resumedAt = await page.locator('#audio-player').evaluate(audio => audio.currentTime);
  await page.evaluate(async () => {
    const version = document.documentElement.dataset.appVersion;
    const store = (await import('/assets/song-library-store.js?v=' + version)).songLibraryStore();
    const core = await import('/assets/song-library-core.js?v=' + version);
    let liked = false;
    // Ordinary song updates must not keep restarting Passport's minute. These
    // synthetic likes exercise shared-store notifications during real media.
    window.fixtureSongChurn = setInterval(() => {
      liked = !liked;
      window.fixtureSongWrite = store.read().then(snapshot => store.mutate(doc => core.setSongLiked(doc,
        { id: 'c'.repeat(64), artist: 'Fixture artist', title: 'Fixture song' }, liked, Date.now()), snapshot.ownerVersion));
    }, 10_000);
  });
  await openPassport(page);
  // This is a real silent media fixture at playbackRate1. Pure synthetic-clock
  // tests separately pin59,999/60,000ms; there is no fast-forwarded wall clock here.
  await expect.poll(() => page.locator('#audio-player').evaluate(audio => audio.currentTime), { timeout: 64_000, intervals: [250] }).toBeGreaterThan(resumedAt + 58);
  await expect(page.locator('#er-passport-countries')).toHaveText('0');
  await expect(page.locator('#er-passport-countries')).toHaveText('1', { timeout: 7000 });
  await expect(page.locator('#er-passport-cities')).toHaveText('1');
  await page.evaluate(async () => { clearInterval(window.fixtureSongChurn); await window.fixtureSongWrite; });
  await expect(page.locator('#er-passport-list')).toContainText('Seoul');
  const value = await passport(page);
  expect(Object.keys(value.countries)).toEqual(['KR']); expect(Object.values(value.cities)[0].countrycode).toBe('KR');
  expect(JSON.stringify(value)).not.toMatch(/https?:|stream|mediaTime|latitude|longitude|access_token/);
  const cloned = await page.evaluate(async () => {
    const module = await import('/assets/discovery-ui.js?v=' + document.documentElement.dataset.appVersion);
    const copy = module.currentPlaybackStation(); copy.station.countrycode = 'US';
    return module.currentPlaybackStation().station.countrycode;
  });
  expect(cloned).toBe('KR');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#er-passport-clear').click();
  await expect(page.locator('#er-passport-countries')).toHaveText('0');
  await expect(page.locator('#er-passport-clear')).toBeEnabled();
  expect((await passport(page)).historyEpoch).toBe(1);
  const recoveredCopies = await page.evaluate(async () => {
    const core = await import('/assets/passport-core.js?v=' + document.documentElement.dataset.appVersion);
    return [':backup', ':previous'].map(suffix => core.decodePassportEnvelope(JSON.parse(localStorage.getItem(core.passportNamespaceKey('default') + suffix)), 'default').value);
  });
  expect(recoveredCopies.every(row => row.historyEpoch === 1 && Object.keys(row.countries).length === 0)).toBe(true);
  await page.locator('#btn-play').click(); await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
});

test('Settings import/export uses the real sanitizers and durable records, including Passport and accurate partial failure', async ({ page }) => {
  await setupApp(page);
  await importSettings(page, { schema: 1,
    favorites: { 'e2e-seoul-0001': { uuid: 'e2e-seoul-0001', addedAt: '2026-11-12T00:00:00Z' } },
    recent: [{ stationuuid: 'e2e-london-0002', name: 'E2E London Jazz', url: 'https://streams.e2e.example/london.mp3' }],
    preferences: { volume: 0.33, unknownSecret: 'fixture-must-be-dropped' },
    passport: { version: 1, historyEpoch: 99, historyClearedAt: 999999, countries: { KR: { firstDay: 20_000, lastDay: 20_000 } }, cities: {} }
  });
  await expect(page.locator('#volume')).toHaveValue('0.33');
  await expect.poll(() => passport(page)).toMatchObject({ historyEpoch: 0, countries: { KR: { firstDay: 20_000 } } });
  const download = page.waitForEvent('download'); await page.locator('#settings-modal [data-click-id="export-data"]').click();
  const data = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(Object.keys(data).sort()).toEqual(['exportedAt', 'favorites', 'passport', 'preferences', 'recent', 'schema']);
  expect(data.favorites['e2e-seoul-0001']).toBeTruthy(); expect(data.recent[0].stationuuid).toBe('e2e-london-0002');
  expect(data.preferences.volume).toBe(0.33); expect(data.preferences.unknownSecret).toBeUndefined();
  expect(data.passport.historyEpoch).toBe(0); expect(data.passport.countries.KR).toBeTruthy();
  expect((await kv(page, 'prefs')).volume).toBe(0.33);
  await page.locator('#settings-modal .settings-header [data-close-settings]').click();
  await importSettings(page, { schema: 1, preferences: { volume: 0.27 }, passport: { version: 999 } });
  await expect(page.locator('#volume')).toHaveValue('0.27');
  await expect(page.locator('#status-line')).toContainText('passport was not added');
  expect((await passport(page)).countries.KR).toBeTruthy();
  await page.reload(); await expect(page.locator('#volume')).toHaveValue('0.27');
  await openPassport(page); await expect(page.locator('#er-passport-countries')).toHaveText('1');
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
});

for (const transition of ['tab', 'authoritative']) test(`a real File.text held across a ${transition} owner transition cannot mutate legacy records or Passport`, async ({ page }) => {
  await setupApp(page); const before = await kv(page, 'prefs');
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== 'held-owner.json') return Reflect.apply(original, this, []);
      window.fixtureTransferHeld = true;
      return new Promise(resolve => { window.fixtureReleaseTransfer = async () => resolve(await Reflect.apply(original, this, [])); });
    };
  });
  await importSettings(page, { schema: 1, preferences: { volume: 0.11 }, passport: { version: 1, countries: { US: { firstDay: 20_000, lastDay: 20_000 } }, cities: {} } }, 'held-owner.json');
  await page.waitForFunction(() => window.fixtureTransferHeld === true);
  await page.evaluate(async transition => {
    if (transition === 'tab') (await import('/assets/song-library-store.js?v=' + document.documentElement.dataset.appVersion)).pauseSongLibraryAccount();
    else await new Promise((resolve, reject) => {
      const open = indexedDB.open('earthRadio', 1);
      open.onerror = () => reject(Error('Fixture owner write failed'));
      open.onsuccess = () => { const db = open.result, tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put('fixture-other-owner', 'account:active');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(Error('Fixture owner write failed')); }; };
    });
    await window.fixtureReleaseTransfer();
  }, transition);
  await page.waitForFunction(() => document.getElementById('import-data-input').value === '');
  expect(await kv(page, 'prefs')).toEqual(before);
  expect(await kv(page, 'earth-radio-passport-v1:default')).toBeUndefined();
});

test('an interrupted legacy import is atomic and leaves both the renderer mirror and Passport unchanged', async ({ page }) => {
  await setupApp(page); const keys = ['favorites', 'recents', 'prefs'];
  const before = await Promise.all(keys.map(key => kv(page, key)));
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.fixtureRestorePut = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === 'prefs') throw new DOMException('Fixture transaction quota', 'QuotaExceededError');
      return Reflect.apply(put, this, [value, key]);
    };
  });
  try {
    await importSettings(page, { schema: 1, favorites: { 'e2e-seoul-0001': { uuid: 'e2e-seoul-0001', addedAt: '2026-11-12T00:00:00Z' } },
      recent: [{ stationuuid: 'e2e-london-0002', name: 'E2E London Jazz' }], preferences: { volume: 0.12 },
      passport: { version: 1, countries: { US: { firstDay: 20_000, lastDay: 20_000 } }, cities: {} } });
    await page.waitForFunction(() => document.getElementById('import-data-input').value === '');
    expect(await Promise.all(keys.map(key => kv(page, key)))).toEqual(before);
    expect(await kv(page, 'earth-radio-passport-v1:default')).toBeUndefined();
  } finally { await page.evaluate(() => window.fixtureRestorePut()); }
  await page.locator('#settings-modal .settings-header [data-close-settings]').click();
  await page.locator('#er-discovery-query').fill('E2E Seoul Pop');
  await expect(page.getByRole('button', { name: 'Favorite station: E2E Seoul Pop', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('Passport-only file import treats unknown future city names as text and never invents a map pin', async ({ page }) => {
  await setupApp(page); await openPassport(page);
  await expect(page.locator('#map')).toHaveAttribute('data-er-map-detail', 'world');
  const markers = page.locator('#map .er-cluster, #map path.leaflet-interactive');
  const before = await markers.count();
  const name = '<img src=x onerror=window.fixtureInjected=1>';
  const chooser = page.waitForEvent('filechooser'); await page.locator('#er-passport .er-passport-import').click();
  await (await chooser).setFiles({ name: 'passport-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    format: 'earth-radio-passport', version: 1, value: { version: 1, countries: { KR: { firstDay: 20_000, lastDay: 20_000 } },
      cities: { 'ne-999999999': { countrycode: 'KR', name, firstDay: 20_000, lastDay: 20_000 } } }
  })) });
  await expect(page.locator('#er-passport-cities')).toHaveText('1');
  await expect(page.locator('#er-passport-list')).toContainText(name);
  await expect(page.locator('#er-passport-list img')).toHaveCount(0);
  expect(await page.evaluate(() => window.fixtureInjected)).toBeUndefined();
  await expect(markers).toHaveCount(before);
});

test('a damaged Passport preserves legacy export and can be explicitly cleared then restored from a known export', async ({ page }) => {
  await setupApp(page);
  const known = await page.evaluate(async () => {
    const version = document.documentElement.dataset.appVersion;
    const store = (await import('/assets/passport-store.js?v=' + version)).passportStore();
    const core = await import('/assets/passport-core.js?v=' + version);
    await store.mutate(doc => core.recordPassportPlace(doc, { countrycode: 'US', confidence: 'country' }, 20_000), await store.read());
    const text = core.exportPassport((await store.read()).value), key = core.passportNamespaceKey('default');
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('earthRadio', 1);
      open.onerror = () => reject(Error('Fixture corruption setup failed'));
      open.onsuccess = () => { const db = open.result, tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ version: 1, namespace: 'default', generation: 3, policyEpoch: 0, payload: 'fixture-damaged', checksum: 'fixture-damaged' }, key);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(Error('Fixture corruption setup failed')); };
      };
    });
    localStorage.removeItem(key + ':backup'); localStorage.removeItem(key + ':previous');
    return text;
  });
  await page.locator('#settings-toggle').click();
  const download = page.waitForEvent('download'); await page.locator('#settings-modal [data-click-id="export-data"]').click();
  const value = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(value.passportOmitted).toBe(true); expect(value.passport).toBeUndefined();
  expect(value.schema).toBe(1); expect(value.preferences.volume).toBeGreaterThan(0);
  await expect(page.locator('.toast').filter({ hasText: 'Your passport could not be included' })).toBeVisible();
  await page.locator('#settings-modal .settings-header [data-close-settings]').click();
  await openPassport(page); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#er-passport-status')).toContainText("couldn't be read");
  await page.locator('#er-passport-history-settings').click();
  await expect(page.locator('#er-song-clear')).toBeEnabled(); page.once('dialog', dialog => dialog.accept());
  await page.locator('#er-song-clear').click(); await expect(page.locator('#er-song-clear')).toBeEnabled();
  await page.locator('#er-you [data-er-library-section="passport"]').click();
  await expect(page.locator('#er-passport-countries')).toHaveText('0');
  await expect(page.locator('#er-passport-import')).toBeEnabled();
  await page.locator('#er-passport-import').setInputFiles({ name: 'known-passport.json', mimeType: 'application/json', buffer: Buffer.from(known) });
  await expect(page.locator('#er-passport-countries')).toHaveText('1');
  expect((await passport(page)).historyEpoch).toBe(1);
  expect(Object.keys((await passport(page)).countries)).toEqual(['US']);
});
