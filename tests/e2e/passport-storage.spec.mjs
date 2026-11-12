import { test, expect } from '@playwright/test';
import { setupApp } from './helpers.mjs';
import { installPassportHarness } from './fixtures/passport-store-harness.mjs';

async function start(page) { await setupApp(page); await installPassportHarness(page); }

test('Passport real IndexedDB isolates accounts, gates first sync and imports guest data explicitly', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const h = window.__passportTest;
    try {
      await h.record('US'); h.check((await h.passport.read()).value.countries.US, 'guest persists');
      await h.setOwner('fixture-alice');
      const empty = await h.passport.read();
      h.check(empty.value === undefined && !empty.canWrite, 'sign-in does not adopt guest and waits for baseline');
      await h.rejects(() => h.record('KR'), 'PASSPORT_SYNC_PENDING', 'first signed-in write gated');
      h.check(await h.passport.guestPassportAvailable(), 'guest addition offered explicitly');
      await h.readyBoth(); await h.passport.importGuest(await h.fence());
      h.check((await h.passport.read()).value.countries.US, 'explicit guest addition succeeds');
      h.check(!await h.passport.guestPassportAvailable(), 'already-added guest does not keep prompting');
      const alice = await h.fence();
      await h.raw([['put', 'account:active', 'fixture-bob']]);
      await h.rejects(() => h.passport.read(), 'ACCOUNT_CHANGED', 'authoritative owner blocks stale tab reads');
      await h.setOwner('fixture-bob');
      h.check((await h.passport.read()).value === undefined, 'second account cannot see first');
      await h.readyBoth();
      await h.rejects(() => h.record('KR', alice), 'ACCOUNT_CHANGED', 'old callback cannot write new account');
      h.pauseOwner(); await h.rejects(() => h.passport.read(), 'PASSPORT_NOT_READY', 'paused owner discloses no data');
      return h.checks;
    } finally { h.dispose(); }
  });
  expect(result).toHaveLength(10);
});

test('history off hides but preserves visits; current clear atomically removes Passport and recovery copies', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const h = window.__passportTest;
    try {
      await h.record('US'); const before = await h.fence();
      await h.policy(false); const disabled = await h.passport.read();
      h.check(disabled.historyEnabled === false && Object.keys(disabled.value?.countries || {}).length === 0, 'off hides counts');
      h.check(h.core.decodePassportEnvelope(await h.raw(null, h.key()), h.namespace()).value.countries.US, 'off preserves prior primary');
      await h.rejects(() => h.record('KR', before), 'PASSPORT_HISTORY_OFF', 'off blocks new record');
      await h.policy(true); h.check((await h.passport.read()).value.countries.US, 'on restores prior visits without backfill');
      await h.rejects(() => h.record('KR', before), 'PASSPORT_POLICY_CHANGED', 'off-on rejects old settings fence');
      await h.clear();
      const primary = h.core.decodePassportEnvelope(await h.raw(null, h.key()), h.namespace());
      h.check(primary.value.historyEpoch === 1 && Object.keys(primary.value.countries).length === 0, 'song clear already cleared Passport primary');
      h.check((await h.raw(null, h.key() + ':privacy')) >= primary.generation, 'clear commits privacy floor');
      h.check(h.backups().every(copy => copy?.value.historyEpoch === 1 && Object.keys(copy.value.countries).length === 0), 'clear purges both mirror copies');
      await h.record('KR'); h.check(Object.keys((await h.passport.read()).value.countries).join() === 'KR', 'new run uses current epoch');
      return h.checks;
    } finally { h.dispose(); }
  });
  expect(result).toHaveLength(9);
});

for (const transition of ['owner', 'clear', 'off-on']) test(`a held native open cannot cross a ${transition} boundary`, async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async transition => {
    const h = window.__passportTest;
    try {
      await h.record('US'); const fence = await h.fence(), started = h.hold('next');
      const pending = h.record('KR', fence).then(() => ({ allowed: true }), error => ({ code: error.code }));
      await started;
      if (transition === 'owner') await h.setOwner('fixture-bob');
      else if (transition === 'clear') await h.clear();
      else { await h.policy(false); await h.policy(true); }
      h.release(); const outcome = await pending;
      h.check(outcome.code === (transition === 'owner' ? 'ACCOUNT_CHANGED' : 'PASSPORT_POLICY_CHANGED'), 'late operation rejected');
      const snapshot = await h.passport.read();
      h.check(!snapshot.value?.countries.KR, 'late observation never appears');
      if (transition === 'off-on') h.check(snapshot.value.countries.US, 'off-on preserves earlier legitimate visit');
      return h.checks;
    } finally { h.dispose(); }
  }, transition);
  expect(result.length).toBe(transition === 'off-on' ? 3 : 2);
});

test('old-client epoch-only clears reconcile before disclosure and reject stale backup recovery', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const h = window.__passportTest;
    try {
      await h.record('US'); const old = new Map(h.copies);
      await h.oldClientClear(); const snapshot = await h.passport.read();
      h.check(snapshot.historyEpoch === 1 && Object.keys(snapshot.value?.countries || {}).length === 0, 'old-client clear reconciles before read');
      h.check(h.backups().every(copy => copy?.value.historyEpoch === 1 && Object.keys(copy.value.countries).length === 0), 'old-client clear purges recoverable copies');
      await h.raw([['delete', h.key()]]);
      for (const [key, value] of old) h.copies.set(key, value);
      let recovered; try { recovered = await h.passport.read(); }
      catch (error) { h.check(error.code === 'PASSPORT_CORRUPT', 'obsolete backups fail closed'); }
      h.check(!recovered?.value?.countries.US, 'stale mirror cannot revive old visit');
      return h.checks;
    } finally { h.dispose(); }
  });
  expect(result.length).toBeGreaterThanOrEqual(3);
});

test('a delayed pre-clear backup publication cannot revive cleared primary or mirrors', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const h = window.__passportTest;
    try {
      await h.record('US'); const before = await h.passport.read(), fence = await h.fence();
      const started = h.hold('generation', before.generation + 1);
      const pending = h.record('KR', fence).then(value => ({ value }), error => ({ code: error.code }));
      await started; await h.clear(); h.release(); const outcome = await pending;
      h.check(outcome.code === 'PASSPORT_POLICY_CHANGED', 'post-clear completion discloses no prior snapshot');
      const current = await h.passport.read();
      h.check(current.historyEpoch === 1 && Object.keys(current.value?.countries || {}).length === 0, 'clear remains primary');
      h.check(h.backups().every(copy => copy?.value.historyEpoch === 1 && Object.keys(copy.value.countries).length === 0), 'late publisher cannot replace cleared mirrors');
      return h.checks;
    } finally { h.dispose(); }
  });
  expect(result).toHaveLength(3);
});

test('Passport corruption, future schema, quota and policy uncertainty retain existing owned data', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const h = window.__passportTest;
    try {
      await h.record('US');
      await h.raw([['put', h.key(), { version: 1, payload: 'corrupt-fixture' }]]);
      h.check((await h.passport.read()).value.countries.US, 'same-owner good backup recovers corrupt primary');
      h.check((await h.raw(null, h.key() + ':damaged')).payload === 'corrupt-fixture', 'corrupt original quarantined');
      const future = { version: 999, namespace: h.namespace(), generation: 3, payload: '{"version":999}' };
      await h.raw([['put', h.key(), future]]);
      await h.rejects(() => h.passport.read(), 'PASSPORT_UPDATE_REQUIRED', 'future primary never replaced by older backup');
      h.check((await h.raw(null, h.key())).version === 999, 'future primary retained');
      await h.raw([['put', h.key(), h.core.encodePassportEnvelope(h.namespace(), 4, h.core.emptyPassport(), 1000)]]);
      const ahead = h.core.recordPassportPlace(h.core.emptyPassport(2), { countrycode: 'US', confidence: 'country' }, 20_000);
      await h.raw([['put', h.key(), h.core.encodePassportEnvelope(h.namespace(), 5, ahead, 1001)]]);
      await h.rejects(() => h.passport.read(), 'PASSPORT_POLICY_PENDING', 'ahead policy does not disclose or erase');
      h.check(h.core.decodePassportEnvelope(await h.raw(null, h.key()), h.namespace()).value.countries.US, 'pending policy data retained');
      await h.raw([['put', h.key(), h.core.encodePassportEnvelope(h.namespace(), 6, h.core.emptyPassport(), 1002)]]);
      await h.record('US'); h.setStorageFailure(true); await h.record('KR');
      const backupUnavailable = await h.passport.read();
      h.check(!backupUnavailable.backupAvailable && backupUnavailable.value.countries.KR, 'mirror quota does not erase committed primary');
      h.setStorageFailure(false);
      const before = await h.raw(null, h.key()), put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) {
        if (key === h.key()) throw new DOMException('Fixture primary quota', 'QuotaExceededError');
        return Reflect.apply(put, this, [value, key]);
      };
      try { await h.rejects(() => h.record('CA'), 'PASSPORT_STORAGE', 'failed primary commit reports storage failure'); }
      finally { IDBObjectStore.prototype.put = put; }
      h.check(JSON.stringify(await h.raw(null, h.key())) === JSON.stringify(before), 'quota preserves earlier primary');
      const unavailable = h.createPassportStore({ indexedDBImpl: null, getAccount: h.owner });
      try { await h.rejects(() => unavailable.read(), 'PASSPORT_STORAGE', 'unavailable IDB never fabricates empty success'); }
      finally { unavailable.dispose(); }
      return h.checks;
    } finally { h.dispose(); }
  });
  expect(result).toHaveLength(10);
});

test('lost signed-in primary forgets its baseline instead of deleting cloud data', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const h = window.__passportTest;
    try {
      await h.setOwner('fixture-alice'); await h.readyBoth(); await h.record('US');
      const value = (await h.passport.read()).value;
      await h.passport.writeSyncState('fixture-alice', { revision: 4, hash: 'fixture-baseline', value });
      await h.raw([['delete', h.key()]]); h.copies.clear();
      const snapshot = await h.passport.read();
      h.check(snapshot.value === undefined && !snapshot.canWrite, 'storage loss waits for cloud recovery');
      h.check(await h.passport.readSyncState('fixture-alice') === undefined, 'storage loss is not a deletion baseline');
      return h.checks;
    } finally { h.dispose(); }
  });
  expect(result).toHaveLength(2);
});

for (const legacy of [false, true]) test(`${legacy ? 'old-client' : 'current-client'} history clear also removes the signed-in sync baseline's private payload`, async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async legacy => {
    const h = window.__passportTest;
    try {
      await h.setOwner('fixture-alice'); await h.readyBoth(); await h.record('US');
      const value = (await h.passport.read()).value;
      await h.passport.writeSyncState('fixture-alice', { revision: 8, hash: JSON.stringify(value), value });
      if (legacy) await h.oldClientClear(); else await h.clear();
      const state = await h.passport.readSyncState('fixture-alice');
      h.check(state.revision === 8 && state.hash === 'passport-policy-cleared', 'clear keeps only revision and dirty sentinel');
      h.check(state.value.historyEpoch === 1 && Object.keys(state.value.countries).length === 0, 'sync baseline has no cleared visits');
      h.check((await h.passport.read()).canWrite, 'previously synced account can continue recording offline');
      await h.passport.writeSyncState('fixture-alice', { revision: 8, hash: JSON.stringify(value), value });
      h.check(!JSON.stringify(await h.passport.readSyncState('fixture-alice')).includes('US'), 'held old-epoch sync acknowledgement cannot restore baseline plaintext');
      return h.checks;
    } finally { h.dispose(); }
  }, legacy);
  expect(result).toHaveLength(4);
});

test('same-epoch primary older than the privacy floor never discloses or recovers removed visits', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const h = window.__passportTest;
    try {
      await h.record('US'); const old = await h.raw(null, h.key()), staleCopies = new Map(h.copies);
      await h.passport.writeForAccount(null, h.core.emptyPassport());
      await h.raw([['put', h.key(), old]]); h.copies.clear();
      for (const [key, value] of staleCopies) h.copies.set(key, value);
      await h.rejects(() => h.passport.read(), 'PASSPORT_CORRUPT', 'privacy floor rejects stale primary and mirrors even within one epoch');
      return h.checks;
    } finally { h.dispose(); }
  });
  expect(result).toHaveLength(1);
});

for (const change of ['disabled', 'legacy-clear']) test(`explicit guest import respects a ${change} guest history policy`, async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async change => {
    const h = window.__passportTest;
    try {
      await h.record('US');
      if (change === 'disabled') await h.policy(false); else await h.oldClientClear();
      await h.setOwner('fixture-alice'); await h.readyBoth();
      h.check(!await h.passport.guestPassportAvailable(), 'private guest data is not offered after history policy change');
      await h.passport.importGuest(await h.fence());
      h.check(!(await h.passport.read()).value?.countries.US, 'explicit addition cannot bypass the guest clear/off policy');
      return h.checks;
    } finally { h.dispose(); }
  }, change);
  expect(result).toHaveLength(2);
});
