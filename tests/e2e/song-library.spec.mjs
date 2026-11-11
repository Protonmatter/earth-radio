import { mkdir, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { setupApp,openSongLibraryView } from './helpers.mjs';
import { reviewBackupOrdering } from './fixtures/song-store-schedule.mjs';

const broadcast = { found: true, source: 'icy', platform: 'icy', artist: 'IU', title: 'Blueming', raw: 'IU - Blueming' };
const moduleVersion = JSON.parse(await readFile('package.json', 'utf8')).version;

test('out-of-order backup callbacks and interrupted removals cannot restore deleted songs', async ({ page }) => {
  await setupApp(page);
  const result = await reviewBackupOrdering(page);
  expect(result.ordering.primaryBefore).toEqual([]);
  expect(result.ordering.backups.every(copy => copy.titles.length === 0)).toBe(true);
  expect(result.ordering.recovered).toEqual([]);
  expect(result.crashGap.errorCode).toBe('LIBRARY_CORRUPT');
  expect(result.crashGap.missingTitles).toEqual([]);
  expect(result.crashGap.nextGeneration).toBeGreaterThanOrEqual(3);
  expect(result.crashGap.nextTitles).toEqual(['Second']);
});
async function playSong(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.__songErrors = errors;
  await page.addInitScript(() => {
    window.__songEvents = [];
    for (const name of ['earthradio:station-selected', 'earthradio:station-cleared']) window.addEventListener(name, e => window.__songEvents.push({ name, detail: e.detail }));
  });
  await setupApp(page, { sameOriginNowPlaying: broadcast });
  await page.locator('#er-discovery-query').fill('Seoul');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E Seoul Pop']);
  await page.locator('.station-card__play').click();
  await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  await expect(page.locator('#player-track')).toContainText('Blueming', { timeout: 25000 });
  await page.locator('#er-open-nowplaying').click();
  const state = () => page.evaluate(async version => ({
    disabled: document.getElementById('er-song-like').disabled,
    owner: (await import(`/assets/song-library-store.js?v=${version}`)).getSongLibraryAccount(),
    song: (await import(`/assets/metadata-enrichment.js?v=${version}`)).getCurrentSongSnapshot(),
    status: document.getElementById('er-song-library-status').textContent,
    events: window.__songEvents
  }), moduleVersion);
  try { await expect.poll(state).toMatchObject({ disabled: false }); }
  catch (error) { console.log(await state()); throw error; }
}

for (const [width, height, night, rtl] of [[1440, 900, false, false], [390, 844, false, false], [320, 568, false, false], [844, 390, false, false], [390, 844, true, false], [390, 844, false, true]]) {
  test(`compact player fits ${width}x${height}${night ? ' Night' : ''}${rtl ? ' Arabic' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    if (rtl) await page.addInitScript(() => localStorage.setItem('earthRadio.ui.v1', JSON.stringify({ locale: 'ar', localeExplicit: true })));
    await playSong(page);
    if (night) {
      await page.locator('#er-nowplaying-dismiss').click();
      await page.locator('#settings-toggle').click();
      if (night) await page.getByRole('button', { name: 'Night', exact: true }).click();
      await page.locator('#settings-modal .settings-header [data-close-settings]').click();
      await page.locator('#er-open-nowplaying').click();
    }
    await expect(page.locator('#er-nowplaying-title')).toHaveText('Blueming');
    await expect(page.locator('#er-nowplaying-meta')).toHaveText('IU');
    const geometry = await page.locator('#er-nowplaying').evaluate(element => {
      const r = element.getBoundingClientRect();
      return { scroll: element.scrollHeight - element.clientHeight, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight,
        targets: [...element.querySelectorAll('button, select, a')].filter(e => e.getBoundingClientRect().height).map(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })) };
    });
    expect(geometry.scroll).toBeLessThanOrEqual(1);
    expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width); expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
    expect(geometry.targets.every(r => r.width >= 43 && r.height >= 43)).toBe(true);
    await expect(page.locator('#er-song-services a')).toHaveCount(4);
    await expect(page.locator('#er-song-services a').first()).toHaveAttribute('aria-label', /Search|البحث/);
    await mkdir('.build/evidence/compact-player', { recursive: true });
    await page.screenshot({ path: `.build/evidence/compact-player/${width}-${height}-${night ? 'night' : rtl ? 'ar' : 'paper'}.png` });
    await page.locator('#er-song-like').click();
    await expect(page.locator('#er-song-like')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-song-details="current"]').click();
    await expect(page.locator('#er-song-details')).toBeVisible();
    await expect(page.locator('#er-song-details-title')).toHaveText('Blueming');
    await page.keyboard.press('Escape');
    await expect(page.locator('#er-song-details')).not.toBeVisible();
    await expect(page.locator('#er-nowplaying')).toBeVisible();
    await page.locator('[data-er-nowplaying-play]').click();
    await expect.poll(() => page.locator('#audio-player').evaluate(a => a.paused)).toBe(true);
    await page.locator('[data-song-details="current"]').click();
    await page.locator('[data-song-remove]').click();
    await expect(page.locator('#er-song-details')).not.toBeVisible();
    await page.locator('#er-nowplaying-dismiss').click();
    await expect(page.locator('#er-nowplaying')).not.toBeVisible();
    expect(page.__songErrors).toEqual([]);
  });
}

test('heard songs, likes, details, removal/undo and reload persist independently from station favorites', async ({ page }) => {
  await playSong(page);
  await expect.poll(() => page.evaluate(async version => {
    const saved = await (await import(`/assets/song-library-store.js?v=${version}`)).songLibraryStore().read();
    return Object.values(saved.value?.tracks || {}).some(row => row.heardAt > 0);
  }, moduleVersion), { timeout: 30000 }).toBe(true);
  expect(await page.locator('#audio-player').evaluate(a => a.currentTime)).toBeGreaterThanOrEqual(15);
  await page.locator('#er-song-like').click();
  await expect(page.locator('#er-song-like')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-er-nowplaying-play]').click();
  await page.locator('#er-nowplaying-dismiss').click();
  await openSongLibraryView(page);
  await expect(page.locator('#er-song-feed')).toContainText('Blueming');
  await page.locator('[data-song-view="liked"]').click();
  await expect(page.locator('#er-song-feed [data-song-id]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#er-song-feed')).toContainText('Blueming');
  await page.locator('#er-song-feed [data-song-details]').click();
  await page.locator('[data-song-remove]').click();
  await expect(page.locator('#er-song-feed [data-song-id]')).toHaveCount(0);
  await page.locator('[data-song-undo]').click();
  await expect(page.locator('#er-song-feed [data-song-id]')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-song-view="recent"]').click();
  await page.locator('#er-song-clear').click();
  await expect(page.locator('#er-song-feed [data-song-id]')).toHaveCount(0);
  await page.locator('[data-song-view="liked"]').click();
  await expect(page.locator('#er-song-feed')).toContainText('Blueming');
  await page.locator('#er-song-history-enabled').uncheck();
  await page.reload();
  await expect(page.locator('#er-song-history-enabled')).not.toBeChecked();
});

test('real IndexedDB storage guards owners, recovers backups and keeps local import explicit', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const core = await import('/assets/song-library-core.js');
    const { createSongLibraryStore } = await import('/assets/song-library-store.js');
    const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const dbName = `song-store-test-${crypto.randomUUID()}`;
    let owner = { ready: true, accountId: null, version: 1 };
    const store = createSongLibraryStore({ indexedDBImpl: { open: (_, version) => indexedDB.open(dbName, version) }, storage, getAccount: () => owner });
    const song = { id: await core.songId({ artist: 'IU', title: 'Blueming' }), artist: 'IU', title: 'Blueming' };
    const checks = [];
    const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
    async function raw(action) {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open(dbName, 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try { return await new Promise((resolve, reject) => { const tx = db.transaction('kv', 'readwrite'); action(tx.objectStore('kv')); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
    }
    try {
      await store.read(); await store.mutate(doc => core.setSongLiked(doc, song, true, 10));
      check((await store.read()).value.tracks[song.id].liked, 'guest persists');
      const guestKey = core.songNamespaceKey('default');
      await raw(kv => kv.put({ version: 1, payload: 'corrupt' }, guestKey));
      check((await store.read()).value.tracks[song.id].liked, 'valid owner backup recovers damaged primary');
      await raw(kv => kv.put('alice', 'account:active')); owner = { ready: true, accountId: 'alice', version: 2 };
      check((await store.read()).value === undefined, 'guest does not automatically enter signed-in library');
      check(await store.guestSongsAvailable(), 'explicit guest import offered');
      try { await store.mutate(doc => core.setSongLiked(doc, song, true)); throw new Error('write unexpectedly allowed'); }
      catch (error) { check(error.code === 'LIBRARY_SYNC_PENDING', 'signed-in edits wait for first sync'); }
      await store.ensureSyncBaseline('alice'); await store.importGuest(2);
      check((await store.read()).value.tracks[song.id].liked, 'explicit guest import succeeds');
      check(!await store.guestSongsAvailable(), 'already imported songs do not keep prompting');
      await store.mutate(doc => core.removeSong(doc, song.id, 20));
      const key = core.songNamespaceKey('account:alice');
      for (const suffix of [':backup', ':previous']) check(!core.decodeSongEnvelope(JSON.parse(values.get(key + suffix)), 'account:alice').value.tracks[song.id].track, `removal purges ${suffix}`);
      await raw(kv => kv.put('bob', 'account:active'));
      try { await store.mutate(doc => core.setSongLiked(doc, song, true)); throw new Error('cross-account write unexpectedly allowed'); }
      catch (error) { check(error.code === 'ACCOUNT_CHANGED', 'authoritative namespace blocks stale tab'); }
      owner = { ready: true, accountId: 'bob', version: 3 }; await store.ensureSyncBaseline('bob');
      check((await store.read()).value === undefined, 'another account cannot read prior songs');
      try { await store.mutate(doc => doc, 2); throw new Error('old callback unexpectedly allowed'); }
      catch (error) { check(error.code === 'ACCOUNT_CHANGED', 'late owner callback rejected'); }
      await raw(kv => kv.put({ version: 999, namespace: 'account:bob', payload: '{"version":999}' }, core.songNamespaceKey('account:bob')));
      try { await store.read(); throw new Error('future schema unexpectedly accepted'); }
      catch (error) { check(error.code === 'LIBRARY_UPDATE_REQUIRED', 'future schema fails closed'); }
    } finally { store.dispose(); }
    return checks;
  });
  expect(result).toHaveLength(13);
});

test('reload and resume preserve the selected station and its canonical song identity on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await playSong(page);
  await page.locator('[data-er-nowplaying-play]').click();
  await page.reload();
  await expect(page.locator('#btn-play')).toHaveAccessibleName('Play E2E Seoul Pop');
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  await page.locator('#btn-play').click();
  await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  await expect(page.locator('#player-track')).toContainText('Blueming', { timeout: 25000 });
  await page.locator('#er-open-nowplaying').click();
  await expect(page.locator('#er-song-like')).toBeEnabled();
  await expect(page.locator('#er-nowplaying-station')).toHaveText('E2E Seoul Pop');
});

test('maximum-length multilingual song credits fit the compact card and remain complete in details', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const artist = '音'.repeat(200), title = '曲'.repeat(200);
  await setupApp(page, { sameOriginNowPlaying: { ...broadcast, artist, title, raw: `${artist} - ${title}` } });
  await page.locator('#er-discovery-query').fill('Seoul');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E Seoul Pop']);
  await page.locator('.station-card__play').click();
  await expect(page.locator('#player-track')).toContainText(title, { timeout: 25000 });
  await page.locator('#er-open-nowplaying').click();
  await expect(page.locator('#er-song-like')).toBeEnabled();
  const bounds = await page.locator('#er-nowplaying').evaluate(e => ({ scroll: e.scrollHeight - e.clientHeight, bottom: e.getBoundingClientRect().bottom, height: innerHeight }));
  expect(bounds.scroll).toBeLessThanOrEqual(1); expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
  await page.locator('[data-song-details="current"]').click();
  await expect(page.locator('#er-song-details-title')).toHaveText(title);
  await expect(page.locator('.er-song-detail-artist')).toHaveText(artist);
});
