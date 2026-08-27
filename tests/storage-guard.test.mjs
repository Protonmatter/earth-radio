import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountIdFromNamespace,
  buildEnvelope,
  checksum,
  decodeEnvelope,
  hasUserSubstance,
  namespaceForAccount,
  selectBestBackup,
  shouldRestore
} from '../site/assets/storage-guard.js';

const completePayload = Object.freeze({
  favorites: { saved: { name: 'Saved Radio' } },
  recents: [{ stationuuid: 'saved' }],
  prefs: { theme: 'dark' },
  badStations: { broken: { failures: 2 } },
  lastPlayed: { stationuuid: 'saved' }
});

test('valid primary generation makes intentional empty data authoritative', () => {
  assert.equal(shouldRestore({
    primaryGeneration: 'g-7',
    backup: { generation: 'g-6', data: { favorites: { old: {} } } },
    restoreAttempts: 0
  }), false);
});

test('missing primary generation restores a valid substantive backup', () => {
  assert.equal(shouldRestore({
    primaryGeneration: '',
    backup: { generation: 'g-6', data: { favorites: { saved: {} } } },
    restoreAttempts: 0
  }), true);
});

test('restoration never runs without a decodable backup', () => {
  assert.equal(shouldRestore({ primaryGeneration: '', backup: null, restoreAttempts: 0 }), false);
  assert.equal(shouldRestore({ primaryGeneration: '', backup: {}, restoreAttempts: 0 }), false);
  assert.equal(shouldRestore({ primaryGeneration: '', backup: { data: 'corrupt' }, restoreAttempts: 0 }), false);
});

test('the immutable namespace and backup generation scope the two-attempt cap', () => {
  const backup = { generation: 3, data: { favorites: { saved: {} } } };
  assert.equal(shouldRestore({ primaryGeneration: '', backup, restoreAttempts: 1 }), true);
  assert.equal(shouldRestore({ primaryGeneration: '', backup, restoreAttempts: 2 }), false);
  assert.equal(shouldRestore({ primaryGeneration: '', backup, restoreAttempts: 99 }), false);
});

test('v2 envelope checksum binds identity, version, generation, time, and payload', () => {
  const envelope = buildEnvelope({ namespace: 'account:user-a', generation: 7, savedAt: 1234, data: completePayload });
  assert.deepEqual(Object.keys(envelope), ['v', 'namespace', 'generation', 'savedAt', 'checksum', 'payload']);
  assert.deepEqual(decodeEnvelope(envelope, 'account:user-a')?.data, completePayload);
  for (const mutation of [
    { namespace: 'account:user-b' },
    { generation: 8 },
    { savedAt: 1235 },
    { payload: JSON.stringify({ ...completePayload, favorites: {} }) },
    { v: 3 }
  ]) {
    assert.equal(decodeEnvelope({ ...envelope, ...mutation }, mutation.namespace || 'account:user-a'), null);
  }
});

test('envelope decoder rejects malformed generations, payloads, and wrong namespaces', () => {
  const valid = buildEnvelope({ namespace: 'default', generation: 1, savedAt: 10, data: completePayload });
  assert.equal(decodeEnvelope({ ...valid, generation: 0 }, 'default'), null);
  assert.equal(decodeEnvelope({ ...valid, generation: 1.5 }, 'default'), null);
  assert.equal(decodeEnvelope({ ...valid, payload: 'not json' }, 'default'), null);
  assert.equal(decodeEnvelope(valid, 'account:user-a'), null);
});

test('newest valid backup wins even when current and previous key order is reversed', () => {
  const older = buildEnvelope({ namespace: 'default', generation: 4, savedAt: 400, data: completePayload });
  const newer = buildEnvelope({ namespace: 'default', generation: 5, savedAt: 500, data: { ...completePayload, prefs: { theme: 'light' } } });
  assert.equal(selectBestBackup([newer, older], 'default').generation, 5);
  assert.equal(selectBestBackup([older, newer], 'default').generation, 5);
  assert.equal(selectBestBackup([{ ...newer, checksum: 'corrupt' }, older], 'default').generation, 4);
  assert.equal(selectBestBackup([{ ...newer, checksum: 'corrupt' }, { ...older, checksum: 'bad' }], 'default'), null);
});

test('canonical namespaces come only from authoritative account ids', () => {
  assert.equal(namespaceForAccount(null), 'default');
  assert.equal(namespaceForAccount(undefined), 'default');
  assert.equal(namespaceForAccount(''), 'default');
  assert.equal(namespaceForAccount(false), 'default');
  assert.equal(namespaceForAccount(0), 'default');
  assert.equal(namespaceForAccount('user/a@example.test'), 'account:user%2Fa%40example.test');
  assert.equal(accountIdFromNamespace('default'), null);
  assert.equal(accountIdFromNamespace('account:user%2Fa%40example.test'), 'user/a@example.test');
  assert.equal(accountIdFromNamespace('account:user-a'), 'user-a');
});

test('checksum detects torn backup representations', () => {
  const representation = JSON.stringify([2, 'default', 2, 20, JSON.stringify(completePayload)]);
  assert.equal(checksum(representation), checksum(representation));
  assert.notEqual(checksum(representation), checksum(representation.slice(0, -2)));
});

test('substance means records a user would miss, not re-seeded defaults', () => {
  assert.equal(hasUserSubstance({ favorites: { a: {} } }), true);
  assert.equal(hasUserSubstance({ recents: [{ stationuuid: 'x' }] }), true);
  assert.equal(hasUserSubstance({ lastPlayed: { stationuuid: 'x' } }), true);
  assert.equal(hasUserSubstance({ favorites: {}, recents: [], prefs: { theme: 'dark' }, badStations: {}, lastPlayed: null }), false);
  assert.equal(hasUserSubstance(null), false);
});

const PRIMARY_KEY = 'earth-radio-storage-generation-v2';
const ACTIVE_KEY = 'account:active';
const RECORD_KEYS = ['favorites', 'recents', 'prefs', 'badStations', 'lastPlayed'];
const defaults = Object.freeze({
  favorites: {}, recents: [], prefs: {}, badStations: {}, lastPlayed: null
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  let failSet = null;
  let failGet = null;
  return {
    values,
    getItem(key) {
      if (failGet?.(key)) throw new DOMException('denied', 'SecurityError');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (failSet?.(key, value)) throw new DOMException('quota', 'QuotaExceededError');
      values.set(key, String(value));
    },
    removeItem: key => values.delete(key),
    failGetsWhere(predicate) { failGet = predicate; },
    failSetsWhere(predicate) { failSet = predicate; }
  };
}

function backupKey(namespace, slot) {
  return `earth-radio-user-backup-v2:${encodeURIComponent(namespace)}:${slot}`;
}

function makeFakeIndexedDb(initial = {}) {
  const state = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
  const transactions = [];
  let writeQueue = Promise.resolve();
  let failPut = null;
  let failCommit = false;
  let beforeWrite = null;
  let writeCount = 0;

  async function run(mode, worker) {
    const execute = async () => {
      const working = mode === 'readwrite'
        ? new Map([...state].map(([key, value]) => [key, clone(value)]))
        : state;
      const entry = { mode, gets: [], puts: [], deletes: [] };
      transactions.push(entry);
      if (mode === 'readwrite') {
        writeCount += 1;
        await beforeWrite?.(writeCount, state);
        for (const [key, value] of state) working.set(key, clone(value));
      }
      let putIndex = 0;
      const store = {
        async get(key) {
          entry.gets.push(key);
          return clone(working.get(key));
        },
        async put(value, key) {
          putIndex += 1;
          entry.puts.push(key);
          if (failPut?.({ key, index: putIndex, transaction: writeCount })) throw new Error(`put failed: ${key}`);
          working.set(key, clone(value));
        },
        async delete(key) {
          entry.deletes.push(key);
          working.delete(key);
        }
      };
      const result = await worker(store);
      if (mode === 'readwrite') {
        if (failCommit) throw new Error('commit failed');
        state.clear();
        for (const [key, value] of working) state.set(key, clone(value));
      }
      return result;
    };
    if (mode !== 'readwrite') return execute();
    const pending = writeQueue.then(execute, execute);
    writeQueue = pending.catch(() => undefined);
    return pending;
  }

  return {
    state,
    transactions,
    transact: (_db, mode, worker) => run(mode, worker),
    failPutsWhere(predicate) { failPut = predicate; },
    failCommit(value = true) { failCommit = value; },
    beforeEachWrite(callback) { beforeWrite = callback; }
  };
}

async function startRuntime({ initialDb = {}, local = {}, session, fake, localStorage } = {}) {
  const database = fake || makeFakeIndexedDb(initialDb);
  const persistent = localStorage || memoryStorage(local);
  const perTab = session || memoryStorage();
  const windowListeners = new Map();
  const documentListeners = new Map();
  let reloads = 0;
  const windowObject = {
    addEventListener: (name, listener) => windowListeners.set(name, listener),
    dispatch: name => windowListeners.get(name)?.()
  };
  const documentObject = {
    hidden: false,
    addEventListener: (name, listener) => documentListeners.set(name, listener)
  };
  const seam = {
    indexedDB: {},
    openDb: async () => ({}),
    transact: database.transact,
    localStorage: persistent,
    sessionStorage: perTab,
    location: { reload: () => { reloads += 1; } },
    window: windowObject,
    document: documentObject,
    setInterval: () => 1,
    now: (() => { let time = 1000; return () => ++time; })()
  };
  globalThis.__EARTH_RADIO_STORAGE_GUARD_TEST__ = seam;
  await import(`../site/assets/storage-guard.js?runtime=${Date.now()}-${Math.random()}`);
  await seam.startPromise;
  delete globalThis.__EARTH_RADIO_STORAGE_GUARD_TEST__;
  return {
    database, localStorage: persistent, sessionStorage: perTab, window: windowObject, seam,
    reloads: () => reloads
  };
}

function primary(namespace, generation, savedAt = 1) {
  return { v: 2, namespace, generation, savedAt };
}

test('startup reads records, account authority, and marker once then restores atomically', async () => {
  const envelope = buildEnvelope({ namespace: 'default', generation: 6, savedAt: 600, data: completePayload });
  const runtime = await startRuntime({ local: { [backupKey('default', 'current')]: JSON.stringify(envelope) } });
  assert.deepEqual(runtime.database.transactions.map(item => item.mode), ['readonly', 'readwrite']);
  assert.deepEqual(runtime.database.transactions[0].gets, [...RECORD_KEYS, ACTIVE_KEY, PRIMARY_KEY]);
  assert.deepEqual(runtime.database.transactions[1].puts, [...RECORD_KEYS, PRIMARY_KEY]);
  assert.deepEqual(runtime.database.state.get('favorites'), completePayload.favorites);
  assert.deepEqual(runtime.database.state.get(PRIMARY_KEY), primary('default', 6, 600));
  assert.equal(runtime.reloads(), 1);
});

test('restore defaults every absent record instead of inheriting unproven primary values', async () => {
  const envelope = buildEnvelope({
    namespace: 'default', generation: 2, savedAt: 20,
    data: { favorites: { restored: {} } }
  });
  const runtime = await startRuntime({
    initialDb: { recents: [{ stationuuid: 'unproven' }], prefs: { theme: 'unproven' }, badStations: { stale: {} }, lastPlayed: { stationuuid: 'stale' } },
    local: { [backupKey('default', 'current')]: JSON.stringify(envelope) }
  });
  assert.deepEqual(Object.fromEntries(RECORD_KEYS.map(key => [key, runtime.database.state.get(key)])), {
    ...defaults, favorites: { restored: {} }
  });
});

test('restore rollback covers the first, middle, last, and marker puts', async t => {
  for (const failureIndex of [1, 3, 5, 6]) {
    await t.test(`put ${failureIndex}`, async () => {
      const fake = makeFakeIndexedDb({ favorites: { original: {} } });
      fake.failPutsWhere(({ index }) => index === failureIndex);
      const envelope = buildEnvelope({ namespace: 'default', generation: 2, savedAt: 20, data: completePayload });
      const runtime = await startRuntime({ fake, local: { [backupKey('default', 'current')]: JSON.stringify(envelope) } });
      assert.equal(runtime.database.transactions.some(item => item.mode === 'readwrite'), true);
      assert.deepEqual(runtime.database.state.get('favorites'), { original: {} });
      assert.equal(runtime.database.state.has(PRIMARY_KEY), false);
      assert.equal(runtime.reloads(), 0);
      assert.equal(runtime.sessionStorage.values.size, 0);
    });
  }
});

test('restore commit failure rolls back all records and preserves the reload allowance', async () => {
  const fake = makeFakeIndexedDb({ favorites: { original: {} } });
  fake.failCommit();
  const envelope = buildEnvelope({ namespace: 'default', generation: 2, savedAt: 20, data: completePayload });
  const runtime = await startRuntime({ fake, local: { [backupKey('default', 'current')]: JSON.stringify(envelope) } });
  assert.equal(runtime.database.transactions.some(item => item.mode === 'readwrite'), true);
  assert.deepEqual(runtime.database.state.get('favorites'), { original: {} });
  assert.equal(runtime.reloads(), 0);
  assert.equal(runtime.sessionStorage.values.size, 0);
});

test('attempt write failure after commit preserves diagnostics and still reloads exactly once', async () => {
  const session = memoryStorage();
  session.failSetsWhere(() => true);
  const localStorage = memoryStorage({
    [backupKey('default', 'current')]: JSON.stringify(buildEnvelope({
      namespace: 'default', generation: 12, savedAt: 120, data: completePayload
    }))
  });
  const fake = makeFakeIndexedDb({ favorites: { stale: {} } });

  const runtime = await startRuntime({ fake, session, localStorage });

  assert.deepEqual(runtime.database.state.get('favorites'), completePayload.favorites);
  assert.deepEqual(runtime.database.state.get(PRIMARY_KEY), primary('default', 12, 120));
  assert.equal(runtime.reloads(), 1);
  assert.match(runtime.seam.status().lastError, /QuotaExceededError/);
  assert.equal(session.values.size, 0);

  const nextBoot = await startRuntime({ fake, session, localStorage });
  assert.equal(nextBoot.reloads(), 0);
  assert.deepEqual(nextBoot.database.state.get('favorites'), completePayload.favorites);
  assert.equal(nextBoot.database.state.get(PRIMARY_KEY).generation, 13);
});

test('inaccessible attempt storage remains fail-closed before restore commit', async () => {
  const session = memoryStorage();
  session.failGetsWhere(() => true);
  const envelope = buildEnvelope({ namespace: 'default', generation: 2, savedAt: 20, data: completePayload });
  const runtime = await startRuntime({
    session,
    initialDb: { favorites: { unproven: {} } },
    local: { [backupKey('default', 'current')]: JSON.stringify(envelope) }
  });
  assert.deepEqual(runtime.database.transactions.map(item => item.mode), ['readonly']);
  assert.deepEqual(runtime.database.state.get('favorites'), { unproven: {} });
  assert.equal(runtime.database.state.has(PRIMARY_KEY), false);
  assert.equal(runtime.reloads(), 0);
});

test('authoritative account namespace fences foreign restore and stale same-account backup', async () => {
  const staleB = buildEnvelope({ namespace: 'account:user-b', generation: 3, savedAt: 30, data: { ...completePayload, favorites: { staleB: {} } } });
  const foreignA = buildEnvelope({ namespace: 'account:user-a', generation: 99, savedAt: 990, data: { ...completePayload, favorites: { secretA: {} } } });
  const runtime = await startRuntime({
    initialDb: {
      [ACTIVE_KEY]: 'user-b',
      [PRIMARY_KEY]: primary('account:user-b', 4, 40),
      ...defaults,
      favorites: { freshArchiveB: {} }
    },
    local: {
      [backupKey('account:user-b', 'current')]: JSON.stringify(staleB),
      [backupKey('account:user-a', 'current')]: JSON.stringify(foreignA)
    }
  });
  assert.deepEqual(runtime.database.state.get('favorites'), { freshArchiveB: {} });
  assert.equal(runtime.database.state.get(PRIMARY_KEY).namespace, 'account:user-b');
  assert.equal(runtime.database.state.get(PRIMARY_KEY).generation, 5);
  assert.equal(runtime.reloads(), 0);
});

test('account change between startup snapshot and restore aborts before any record write', async () => {
  const fake = makeFakeIndexedDb({ [ACTIVE_KEY]: 'user-a', favorites: { aPrimary: {} } });
  fake.beforeEachWrite((_number, state) => state.set(ACTIVE_KEY, 'user-b'));
  const envelope = buildEnvelope({ namespace: 'account:user-a', generation: 4, savedAt: 40, data: completePayload });
  const runtime = await startRuntime({
    fake,
    local: { [backupKey('account:user-a', 'current')]: JSON.stringify(envelope) }
  });
  assert.deepEqual(runtime.database.state.get('favorites'), { aPrimary: {} });
  assert.equal(runtime.database.state.get(ACTIVE_KEY), 'user-b');
  assert.equal(runtime.database.state.has(PRIMARY_KEY), false);
  assert.equal(runtime.reloads(), 0);
});

test('valid substantive v1 backup migrates only to default and is removed after v2 marker commit', async () => {
  const payload = JSON.stringify(completePayload);
  const legacy = JSON.stringify({ v: 1, savedAt: 70, checksum: checksum(payload), payload });
  const runtime = await startRuntime({ local: { 'earth-radio-user-backup-v1': legacy } });
  assert.deepEqual(runtime.database.state.get('favorites'), completePayload.favorites);
  assert.equal(runtime.localStorage.getItem('earth-radio-user-backup-v1'), null);
  assert.ok(runtime.localStorage.getItem(backupKey('default', 'current')));
  assert.equal(runtime.reloads(), 1);

  const authenticated = await startRuntime({
    initialDb: { [ACTIVE_KEY]: 'user-a' },
    local: { 'earth-radio-user-backup-v1': legacy }
  });
  assert.notDeepEqual(authenticated.database.state.get('favorites'), completePayload.favorites);
  assert.ok(authenticated.localStorage.getItem('earth-radio-user-backup-v1'));
});

test('v1 source remains recoverable when its v2 marker transaction cannot commit', async () => {
  const payload = JSON.stringify(completePayload);
  const legacy = JSON.stringify({ v: 1, savedAt: 70, checksum: checksum(payload), payload });
  const fake = makeFakeIndexedDb();
  fake.failCommit();
  const runtime = await startRuntime({ fake, local: { 'earth-radio-user-backup-v1': legacy } });
  assert.equal(runtime.reloads(), 0);
  assert.equal(runtime.localStorage.getItem('earth-radio-user-backup-v1'), legacy);
  assert.equal(runtime.database.state.has(PRIMARY_KEY), false);
});

test('corrupt or empty v1 backups never migrate', async () => {
  const emptyPayload = JSON.stringify({ favorites: {}, recents: [], prefs: {}, badStations: {}, lastPlayed: null });
  for (const legacy of [
    { v: 1, savedAt: 1, checksum: 'wrong', payload: JSON.stringify(completePayload) },
    { v: 1, savedAt: 2, checksum: checksum(emptyPayload), payload: emptyPayload }
  ]) {
    const runtime = await startRuntime({ local: { 'earth-radio-user-backup-v1': JSON.stringify(legacy) } });
    assert.equal(runtime.reloads(), 0);
    assert.ok(runtime.localStorage.getItem('earth-radio-user-backup-v1'));
  }
});

test('corrupt current falls back to valid previous and newest valid generation is restored', async () => {
  const generation8 = buildEnvelope({ namespace: 'default', generation: 8, savedAt: 80, data: { ...completePayload, favorites: { newest: {} } } });
  const generation7 = buildEnvelope({ namespace: 'default', generation: 7, savedAt: 70, data: { ...completePayload, favorites: { older: {} } } });
  const runtime = await startRuntime({
    local: {
      [backupKey('default', 'current')]: JSON.stringify({ ...generation7, checksum: 'corrupt' }),
      [backupKey('default', 'previous')]: JSON.stringify(generation8)
    }
  });
  assert.deepEqual(runtime.database.state.get('favorites'), { newest: {} });
  assert.equal(runtime.database.state.get(PRIMARY_KEY).generation, 8);
});

test('localStorage failure cannot advance the primary generation', async t => {
  for (const failedSlot of ['previous', 'current']) {
    await t.test(failedSlot, async () => {
      const older = buildEnvelope({ namespace: 'default', generation: 2, savedAt: 20, data: completePayload });
      const oldest = buildEnvelope({ namespace: 'default', generation: 1, savedAt: 10, data: { ...completePayload, favorites: { oldest: {} } } });
      const localStorage = memoryStorage({
        [backupKey('default', 'current')]: JSON.stringify(older),
        [backupKey('default', 'previous')]: JSON.stringify(oldest)
      });
      localStorage.failSetsWhere(key => key === backupKey('default', failedSlot));
      const runtime = await startRuntime({
        initialDb: { [PRIMARY_KEY]: primary('default', 2, 20), ...defaults }, localStorage
      });
      assert.equal(runtime.database.transactions.some(item => item.mode === 'readwrite'), true);
      assert.deepEqual(runtime.database.state.get(PRIMARY_KEY), primary('default', 2, 20));
      assert.equal(JSON.parse(runtime.localStorage.getItem(backupKey('default', 'current'))).generation, 2);
      assert.equal(JSON.parse(runtime.localStorage.getItem(backupKey('default', 'previous'))).generation, 1);
    });
  }
});

test('serialized snapshot writers claim monotonic generations and preserve two coherent payloads', async () => {
  const fake = makeFakeIndexedDb({ [PRIMARY_KEY]: primary('default', 1, 10), ...defaults });
  fake.beforeEachWrite((number, state) => {
    if (number === 2) state.set('favorites', { first: {} });
    if (number === 3) state.set('favorites', { second: {} });
  });
  const runtime = await startRuntime({ fake });
  await Promise.all([runtime.window.earthRadioStorageGuard.snapshotNow(), runtime.window.earthRadioStorageGuard.snapshotNow()]);
  const current = JSON.parse(runtime.localStorage.getItem(backupKey('default', 'current')));
  const previous = JSON.parse(runtime.localStorage.getItem(backupKey('default', 'previous')));
  assert.deepEqual([current.generation, previous.generation], [4, 3]);
  assert.deepEqual(JSON.parse(current.payload).favorites, { second: {} });
  assert.deepEqual(JSON.parse(previous.payload).favorites, { first: {} });
  assert.equal(runtime.database.state.get(PRIMARY_KEY).generation, 4);
});

test('restore attempts are capped at two reloads per immutable namespace and generation', async () => {
  const session = memoryStorage();
  const localStorage = memoryStorage({
    [backupKey('default', 'current')]: JSON.stringify(buildEnvelope({ namespace: 'default', generation: 5, savedAt: 50, data: completePayload }))
  });
  let reloads = 0;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const fake = makeFakeIndexedDb();
    const runtime = await startRuntime({ fake, session, localStorage });
    reloads += runtime.reloads();
  }
  assert.equal(reloads, 2);
  assert.equal([...session.values.values()][0], '2');
});

test('intentional empty primary state remains authoritative and snapshots coherently', async () => {
  const stale = buildEnvelope({ namespace: 'default', generation: 6, savedAt: 60, data: completePayload });
  const runtime = await startRuntime({
    initialDb: { [PRIMARY_KEY]: primary('default', 7, 70), ...defaults },
    local: { [backupKey('default', 'current')]: JSON.stringify(stale) }
  });
  assert.equal(runtime.reloads(), 0);
  assert.deepEqual(runtime.database.state.get('favorites'), {});
  const current = JSON.parse(runtime.localStorage.getItem(backupKey('default', 'current')));
  assert.equal(current.generation, 8);
  assert.deepEqual(JSON.parse(current.payload).favorites, {});
});

test('valid intentional-empty v2 backup replaces stale primary state and reloads exactly once', async () => {
  const emptyData = { favorites: {}, recents: [], prefs: { theme: 'dark' }, badStations: {}, lastPlayed: null };
  const empty = buildEnvelope({ namespace: 'default', generation: 9, savedAt: 90, data: emptyData });
  const runtime = await startRuntime({
    initialDb: { favorites: { unproven: {} }, lastPlayed: { stationuuid: 'unproven' } },
    local: { [backupKey('default', 'current')]: JSON.stringify(empty) }
  });
  assert.deepEqual(runtime.database.transactions.map(item => item.mode), ['readonly', 'readwrite']);
  assert.deepEqual(runtime.database.state.get('favorites'), {});
  assert.equal(runtime.database.state.get('lastPlayed'), null);
  assert.deepEqual(runtime.database.state.get(PRIMARY_KEY), primary('default', 9, 90));
  assert.equal(runtime.reloads(), 1);
});

test('prefs-only and badStations-only restores each reload exactly once after commit', async t => {
  for (const [label, data, expectedKey, expected] of [
    ['prefs-only', { prefs: { theme: 'light' } }, 'prefs', { theme: 'light' }],
    ['badStations-only', { badStations: { broken: { failures: 4 } } }, 'badStations', { broken: { failures: 4 } }]
  ]) {
    await t.test(label, async () => {
      const envelope = buildEnvelope({ namespace: 'default', generation: 11, savedAt: 110, data });
      const runtime = await startRuntime({
        initialDb: { favorites: { stale: {} }, prefs: { theme: 'stale' }, lastPlayed: { stationuuid: 'stale' } },
        local: { [backupKey('default', 'current')]: JSON.stringify(envelope) }
      });
      assert.deepEqual(runtime.database.state.get(expectedKey), expected);
      assert.deepEqual(runtime.database.state.get('favorites'), {});
      assert.equal(runtime.database.state.get('lastPlayed'), null);
      assert.equal(runtime.database.state.get(PRIMARY_KEY).generation, 11);
      assert.equal(runtime.reloads(), 1);
    });
  }
});

test('pagehide cannot certify stale primary memory after the generation marker is lost', async () => {
  const runtime = await startRuntime({
    initialDb: { [PRIMARY_KEY]: primary('default', 4, 40), ...defaults, favorites: { stale: {} } }
  });
  const empty = buildEnvelope({
    namespace: 'default', generation: 6, savedAt: 60,
    data: { favorites: {}, recents: [], prefs: {}, badStations: {}, lastPlayed: null }
  });
  runtime.localStorage.setItem(backupKey('default', 'current'), JSON.stringify(empty));
  runtime.database.state.delete(PRIMARY_KEY);
  runtime.database.state.set('favorites', { staleInMemory: {} });

  runtime.window.dispatch('pagehide');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(runtime.database.state.has(PRIMARY_KEY), false);
  const current = JSON.parse(runtime.localStorage.getItem(backupKey('default', 'current')));
  assert.equal(current.generation, 6);
  assert.deepEqual(JSON.parse(current.payload).favorites, {});
});

test('v1 migration treats customized preferences as substantive', async () => {
  const { checksum, readBestV1Backup } = await import('../site/assets/storage-guard.js');
  const makeV1 = data => {
    const payload = JSON.stringify(data);
    return JSON.stringify({ v: 1, savedAt: 4200, checksum: checksum(payload), payload });
  };
  const storage = values => ({ getItem: key => values[key] ?? null });
  const prefsOnly = readBestV1Backup(storage({
    'earth-radio-user-backup-v1': makeV1({ favorites: {}, recents: [], prefs: { theme: 'dark', locale: 'ko' } })
  }));
  assert.ok(prefsOnly, 'a prefs-only v1 backup migrates instead of re-seeding defaults');
  assert.equal(prefsOnly.data.prefs.theme, 'dark');
  // Truly empty data still has nothing worth restoring.
  const empty = readBestV1Backup(storage({
    'earth-radio-user-backup-v1': makeV1({ favorites: {}, recents: [], prefs: {} })
  }));
  assert.equal(empty, null);
});

test('the reapply record survives a failed corrective transaction and applies on retry', async () => {
  const session = memoryStorage();
  session.setItem('earth-radio-user-restore-reapply-v2', JSON.stringify({
    namespace: 'default', generation: 4, savedAt: 400, data: completePayload
  }));

  // First boot: the corrective transaction cannot commit. The record exists exactly
  // because stale runtime writes can survive under a still-valid marker, so it must
  // be retained for the next boot rather than consumed on the failed attempt.
  const failing = makeFakeIndexedDb({});
  failing.failCommit();
  await startRuntime({ fake: failing, session });
  assert.ok(session.values.get('earth-radio-user-restore-reapply-v2'), 'record must be retained after a failed reapply');

  // Second boot: the transaction commits; records and marker are applied and only
  // then is the record consumed.
  const working = makeFakeIndexedDb({});
  const runtime = await startRuntime({ fake: working, session });
  assert.equal(runtime.sessionStorage.values.get('earth-radio-user-restore-reapply-v2'), undefined);
  assert.deepEqual(working.state.get('favorites'), completePayload.favorites);
  // The reapply committed marker generation 4; the boot's own snapshot may then
  // legitimately advance it, so assert it moved past the stale pre-restore state.
  assert.ok((working.state.get('earth-radio-storage-generation-v2')?.generation ?? 0) >= 4);
});

test('signed-in restore after IDB wipe uses the surviving auth session namespace', async () => {
  const envelope = buildEnvelope({
    namespace: 'account:user-a',
    generation: 4,
    savedAt: 40,
    data: completePayload
  });
  const runtime = await startRuntime({
    local: {
      [backupKey('account:user-a', 'current')]: JSON.stringify(envelope),
      'earthRadio.auth.activeUser.v1': 'user-a'
    }
  });
  assert.deepEqual(runtime.database.state.get('favorites'), completePayload.favorites);
  assert.equal(runtime.database.state.get(ACTIVE_KEY), 'user-a');
  assert.equal(runtime.database.state.get(PRIMARY_KEY).namespace, 'account:user-a');
  assert.equal(runtime.database.state.get(PRIMARY_KEY).generation, 4);
  assert.equal(runtime.reloads(), 1);
});

test('auth session cannot restore a different account backup after IDB wipe', async () => {
  const foreign = buildEnvelope({
    namespace: 'account:user-b',
    generation: 4,
    savedAt: 40,
    data: completePayload
  });
  const runtime = await startRuntime({
    local: {
      [backupKey('account:user-b', 'current')]: JSON.stringify(foreign),
      'earthRadio.auth.activeUser.v1': 'user-a'
    }
  });
  assert.notDeepEqual(runtime.database.state.get('favorites'), completePayload.favorites);
  assert.equal(runtime.database.state.get(ACTIVE_KEY), 'user-a');
  assert.equal(runtime.database.state.get(PRIMARY_KEY).namespace, 'account:user-a');
  assert.equal(runtime.reloads(), 0);
});
