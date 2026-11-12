import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserTransfer, USER_TRANSFER_MAX_BYTES } from '../site/assets/user-transfer.js';
import { emptyPassport, recordPassportPlace, exportPassport } from '../site/assets/passport-core.js';

const visit = (doc, countrycode) => recordPassportPlace(doc, { countrycode, confidence: 'country' }, 20_000);
const file = value => { const text = typeof value === 'string' ? value : JSON.stringify(value); return { size: Buffer.byteLength(text), text: async () => text }; };
function fixture() {
  let owner = { ready: true, accountId: null, version: 1 }, doc = visit(emptyPassport(), 'US'), enabled = true, settingsVersion = 0;
  const legacy = { schema: 1, favorites: { fixture: { uuid: 'fixture' } }, recent: [], preferences: { volume: 0.4 } };
  const applied = [], prepared = [], writes = [];
  let beforeRead = null, beforeCommit = null, beforeOwnerCheck = null;
  const passport = {
    captureFence() { return { namespace: owner.accountId ? 'account:' + owner.accountId : 'default', ownerVersion: owner.version,
      historyEpoch: doc.historyEpoch, historyClearedAt: doc.historyClearedAt, settingsVersion, historyEnabled: enabled }; },
    async readPolicy() { return this.captureFence(); },
    async read() {
      const snapshot = { namespace: owner.accountId ? 'account:' + owner.accountId : 'default', ownerVersion: owner.version,
        historyEpoch: doc.historyEpoch, historyClearedAt: doc.historyClearedAt, settingsVersion, historyEnabled: enabled, canWrite: enabled,
        value: structuredClone(enabled ? doc : emptyPassport(doc.historyEpoch)) };
      if (beforeRead) await beforeRead(); return snapshot;
    },
    async mutate(transform, fence) {
      const code = owner.version !== fence.ownerVersion ? 'ACCOUNT_CHANGED' : !enabled ? 'PASSPORT_HISTORY_OFF'
        : doc.historyEpoch !== fence.historyEpoch ? 'PASSPORT_POLICY_CHANGED' : null;
      if (code) throw Object.assign(Error(code), { code });
      doc = transform(doc); writes.push(structuredClone(doc)); return structuredClone(doc);
    }
  };
  const transfer = createUserTransfer({ getAccount: () => ({ ...owner }), passport,
    readLegacy: () => structuredClone(legacy), verifyOwner: async expected => {
      if (beforeOwnerCheck) await beforeOwnerCheck(); assert.equal(owner.version, expected.version);
    }, prepareLegacy: payload => {
      prepared.push(payload); return { records: { prefs: { volume: payload.preferences?.volume ?? 0.5 } },
        report: { favoritesImported: 1, recentImported: 0, preferencesImported: 1 } };
    }, commitLegacy: async (_records, expected) => {
      if (beforeCommit) await beforeCommit();
      assert.equal(owner.version, expected.version); applied.push('durable');
    }, applyLegacy: records => applied.push(records) });
  return { transfer, passport, legacy, prepared, applied, writes, doc: () => structuredClone(doc),
    setOwner() { owner = { ...owner, accountId: 'fixture-second', version: owner.version + 1 }; },
    setOff() { enabled = false; settingsVersion++; }, setOn() { enabled = true; settingsVersion++; }, clear() { doc = emptyPassport(doc.historyEpoch + 1, 1000); },
    onRead(fn) { beforeRead = fn; }, onCommit(fn) { beforeCommit = fn; }, onOwnerCheck(fn) { beforeOwnerCheck = fn; } };
}

for (const boundary of ['clear', 'off-on', 'owner', 'cancel']) test(`pre-picker ticket rejects ${boundary} before preparing either document`, async () => {
  const h = fixture(), ticket = h.transfer.beginImport();
  if (boundary === 'clear') h.clear();
  else if (boundary === 'off-on') { h.setOff(); h.setOn(); }
  else if (boundary === 'owner') h.setOwner();
  else h.transfer.cancelImport(ticket);
  await assert.rejects(h.transfer.importFile(file({ schema: 1, preferences: { volume: 0.1 }, passport: visit(emptyPassport(), 'KR') }), { ticket }),
    error => error.code === (boundary === 'owner' ? 'ACCOUNT_CHANGED' : 'PASSPORT_POLICY_CHANGED'));
  assert.equal(h.prepared.length, 0); assert.equal(h.applied.length, 0); assert.equal(h.writes.length, 0);
});

test('unchanged picker ticket imports once and cannot be replayed or borrowed by another transfer', async () => {
  const h = fixture(), other = fixture(), ticket = h.transfer.beginImport(), input = file(exportPassport(visit(emptyPassport(), 'KR')));
  await assert.rejects(other.transfer.importFile(input, { ticket }), error => error.code === 'PASSPORT_POLICY_CHANGED');
  assert.equal((await h.transfer.importFile(input, { ticket })).passportImported, true);
  await assert.rejects(h.transfer.importFile(input, { ticket }), error => error.code === 'PASSPORT_POLICY_CHANGED');
});

test('general export retains schema1 legacy records and includes only the current private Passport', async () => {
  const h = fixture(); h.legacy.unrelatedPrivateField = 'fixture-must-stay-out';
  const value = await h.transfer.exportData();
  assert.equal(value.schema, 1); assert.deepEqual(value.favorites, h.legacy.favorites);
  assert.deepEqual(value.passport, h.doc());
  assert.deepEqual(Object.keys(value).sort(), ['favorites', 'passport', 'preferences', 'recent', 'schema']);
});
test('old legacy files larger than a two-MiB song export remain supported', async () => {
  const h = fixture(), payload = { schema: 1, favorites: { fixture: { name: 'x'.repeat(3 * 1024 * 1024) } }, preferences: { volume: 0.3 } };
  const result = await h.transfer.importFile(file(payload));
  assert.equal(result.partial, false); assert.equal(result.passportImported, false);
  assert.equal(h.applied[0], 'durable'); assert.deepEqual(h.applied[1], { prefs: { volume: 0.3 } });
  assert.equal(h.writes.length, 0); assert.equal(h.prepared[0].favorites.fixture.name.length, 3 * 1024 * 1024);
});
test('general import adds positive visits without applying foreign clear counters', async () => {
  const h = fixture(), addition = visit(emptyPassport(99, 999999), 'KR');
  const report = await h.transfer.importFile(file({ schema: 1, preferences: { volume: 0.5 }, passport: addition }));
  assert.equal(report.passportImported, true); assert.equal(report.partial, false);
  assert.equal(h.doc().historyEpoch, 0); assert.deepEqual(Object.keys(h.doc().countries), ['KR', 'US']);
});
test('Passport-only files use an explicit path without invoking legacy import', async () => {
  const h = fixture(), addition = visit(emptyPassport(), 'KR');
  const report = await h.transfer.importFile(file(exportPassport(addition)));
  assert.equal(report.passportImported, true); assert.equal(report.legacy, null);
  assert.equal(h.prepared.length, 0); assert.equal(h.applied.length, 0);
  assert.deepEqual(JSON.parse(await h.transfer.exportPassportData()).value, h.doc());
});
test('a failed Passport add-on reports partial success after durable legacy import', async () => {
  const h = fixture();
  const result = await h.transfer.importFile(file({ schema: 1, preferences: { volume: 0.6 }, passport: { version: 999 } }));
  assert.equal(result.partial, true); assert.equal(result.passportImported, false);
  assert.equal(result.passportError, 'PASSPORT_UPDATE_REQUIRED');
  assert.equal(result.legacy.preferencesImported, 1); assert.equal(h.applied[0], 'durable');
  assert.equal(h.writes.length, 0); assert.ok(h.doc().countries.US);
});
test('history-off exports no hidden visits and blocks importing visits', async () => {
  const h = fixture(); h.setOff();
  assert.deepEqual((await h.transfer.exportData()).passport.countries, {});
  await assert.rejects(h.transfer.importFile(file(exportPassport(visit(emptyPassport(), 'KR')))), error => error.code === 'PASSPORT_HISTORY_OFF');
  assert.deepEqual(Object.keys(h.doc().countries), ['US']);
});
for (const boundary of ['owner', 'clear']) test(`a file read held across a ${boundary} boundary cannot import a stale Passport`, async () => {
  const h = fixture(); let release, started;
  const gate = new Promise(resolve => { started = resolve; });
  const text = exportPassport(visit(emptyPassport(), 'KR'));
  const pending = h.transfer.importFile({ size: text.length, text: () => { started(); return new Promise(resolve => { release = () => resolve(text); }); } });
  await gate; if (boundary === 'owner') h.setOwner(); else h.clear(); release();
  await assert.rejects(pending, error => error.code === (boundary === 'owner' ? 'ACCOUNT_CHANGED' : 'PASSPORT_POLICY_CHANGED'));
  assert.equal(h.writes.length, 0); assert.equal(h.prepared.length, 0);
});
test('legacy persistence failure never claims success or applies Passport', async () => {
  const h = fixture(); h.onCommit(() => { throw Object.assign(Error('Fixture quota'), { code: 'TRANSFER_STORAGE' }); });
  await assert.rejects(h.transfer.importFile(file({ schema: 1, preferences: { volume: 0.6 }, passport: visit(emptyPassport(), 'KR') })), error => error.code === 'TRANSFER_STORAGE');
  assert.equal(h.applied.length, 0); assert.equal(h.writes.length, 0);
});
test('future transfer formats and oversized files fail before legacy preparation', async () => {
  const h = fixture();
  assert.ok(USER_TRANSFER_MAX_BYTES >= 10 * 1024 * 1024);
  await assert.rejects(h.transfer.importFile({ size: USER_TRANSFER_MAX_BYTES + 1, text: () => assert.fail('oversize file must not be read') }), error => error.code === 'TRANSFER_INVALID');
  await assert.rejects(h.transfer.importFile(file({ schema: 999, favorites: {} })), error => error.code === 'TRANSFER_INVALID');
  await assert.rejects(h.transfer.importFile(file({ format: 'unrelated', version: 1 })), error => error.code === 'TRANSFER_INVALID');
  assert.equal(h.prepared.length, 0);
});
test('export held across an owner change never returns the prior profile', async () => {
  const h = fixture(); h.onRead(() => h.setOwner());
  await assert.rejects(h.transfer.exportData(), error => error.code === 'ACCOUNT_CHANGED');
});
test('an unreadable Passport never blocks legacy export or silently claims the Passport was included', async () => {
  const h = fixture(); h.onRead(() => { throw Object.assign(Error('Fixture corruption'), { code: 'PASSPORT_CORRUPT' }); });
  const data = await h.transfer.exportData();
  assert.equal(data.passportOmitted, true); assert.equal(Object.hasOwn(data, 'passport'), false);
  assert.deepEqual(data.favorites, h.legacy.favorites); assert.equal(h.applied.length, 0); assert.equal(h.writes.length, 0);
  await assert.rejects(h.transfer.exportPassportData(), error => error.code === 'PASSPORT_CORRUPT');
});
test('legacy-only recovery export still requires an independent authoritative owner check', async () => {
  const h = fixture(); h.onRead(() => { throw Object.assign(Error('Fixture corruption'), { code: 'PASSPORT_CORRUPT' }); });
  h.onOwnerCheck(() => { throw Object.assign(Error('Fixture changed owner'), { code: 'ACCOUNT_CHANGED' }); });
  await assert.rejects(h.transfer.exportData(), error => error.code === 'ACCOUNT_CHANGED');
});
