// Earth Radio user-storage guard v2.0.0
// The authoritative account namespace and all protected records are read from one
// IndexedDB snapshot. Recovery and account transitions use atomic kv transactions.

const DB_NAME = 'earthRadio';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const ACTIVE_NAMESPACE_KEY = 'account:active';
const PRIMARY_GENERATION_KEY = 'earth-radio-storage-generation-v2';
const USER_KEYS = Object.freeze(['favorites', 'recents', 'prefs', 'badStations', 'lastPlayed']);
const DEFAULT_RECORDS = Object.freeze({
  favorites: {},
  recents: [],
  prefs: {},
  badStations: {},
  lastPlayed: null
});
const LEGACY_BACKUP_KEYS = Object.freeze([
  'earth-radio-user-backup-v1',
  'earth-radio-user-backup-v1-prev'
]);
const RESTORE_ATTEMPT_PREFIX = 'earth-radio-user-restore-attempt-v2';
const RESTORE_REAPPLY_KEY = 'earth-radio-user-restore-reapply-v2';
const SNAPSHOT_INTERVAL_MS = 20 * 1000;

const guard = {
  enabled: true,
  restored: false,
  lastError: '',
  hasBackup: false
};

export function checksum(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function namespaceForAccount(accountId) {
  return typeof accountId !== 'string' || accountId.length === 0
    ? 'default'
    : `account:${encodeURIComponent(accountId)}`;
}

function envelopeRepresentation({ v, namespace, generation, savedAt, payload }) {
  return JSON.stringify([v, namespace, generation, savedAt, payload]);
}

export function buildEnvelope({ namespace, generation, savedAt = Date.now(), data }) {
  const payload = JSON.stringify(data);
  const envelope = { v: 2, namespace, generation, savedAt, checksum: '', payload };
  envelope.checksum = checksum(envelopeRepresentation(envelope));
  return envelope;
}

export function decodeEnvelope(envelope, expectedNamespace) {
  if (!envelope || envelope.v !== 2 || envelope.namespace !== expectedNamespace ||
      !Number.isSafeInteger(envelope.generation) || envelope.generation < 1 ||
      !Number.isFinite(envelope.savedAt) || envelope.savedAt < 0 || typeof envelope.payload !== 'string' ||
      checksum(envelopeRepresentation(envelope)) !== envelope.checksum) return null;
  try {
    const data = JSON.parse(envelope.payload);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return { ...envelope, data };
  } catch {
    return null;
  }
}

export function selectBestBackup(envelopes, namespace) {
  return (Array.isArray(envelopes) ? envelopes : [])
    .map(envelope => decodeEnvelope(envelope, namespace))
    .filter(Boolean)
    .sort((left, right) => right.generation - left.generation || right.savedAt - left.savedAt)[0] || null;
}

export function hasUserSubstance(data) {
  if (!data) return false;
  const favorites = data.favorites;
  const recents = data.recents;
  return (favorites && typeof favorites === 'object' && Object.keys(favorites).length > 0) ||
    (Array.isArray(recents) && recents.length > 0) || data.lastPlayed != null;
}

export function shouldRestore({ primaryGeneration, backup, restoreAttempts: attempts = 0 }) {
  if (primaryGeneration) return false;
  if (!backup || typeof backup !== 'object' || !backup.data || typeof backup.data !== 'object') return false;
  return Number(attempts) < 2;
}

function backupStorageKey(namespace, slot) {
  return `earth-radio-user-backup-v2:${encodeURIComponent(namespace)}:${slot}`;
}

function parseStoredEnvelope(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readBestV2Backup(storage, namespace) {
  return selectBestBackup([
    parseStoredEnvelope(storage, backupStorageKey(namespace, 'current')),
    parseStoredEnvelope(storage, backupStorageKey(namespace, 'previous'))
  ], namespace);
}

export function readBestV1Backup(storage) {
  const valid = [];
  for (const key of LEGACY_BACKUP_KEYS) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || typeof parsed.payload !== 'string' ||
          checksum(parsed.payload) !== parsed.checksum || !Number.isFinite(Number(parsed.savedAt))) continue;
      const data = JSON.parse(parsed.payload);
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      // Customized preferences are worth migrating even without favorites/recents:
      // rejecting a prefs-only v1 backup would let a lost store re-seed defaults and
      // permanently discard theme/locale/volume settings.
      const customizedPrefs = data.prefs && typeof data.prefs === 'object' && !Array.isArray(data.prefs) &&
        Object.keys(data.prefs).length > 0;
      if (!hasUserSubstance(data) && !customizedPrefs) continue;
      valid.push({ generation: 1, savedAt: Number(parsed.savedAt), data, legacy: true });
    } catch {
      // Corrupt legacy data remains in place for diagnostics and possible manual recovery.
    }
  }
  return valid.sort((left, right) => right.savedAt - left.savedAt)[0] || null;
}

function markerIsValid(marker, namespace) {
  return Boolean(marker && marker.v === 2 && marker.namespace === namespace &&
    Number.isSafeInteger(marker.generation) && marker.generation > 0 &&
    Number.isFinite(marker.savedAt) && marker.savedAt >= 0);
}

function primaryMarker(namespace, generation, savedAt) {
  return { v: 2, namespace, generation, savedAt };
}

function completeRecords(data) {
  return Object.fromEntries(USER_KEYS.map(key => [
    key,
    Object.prototype.hasOwnProperty.call(data || {}, key)
      ? structuredClone(data[key])
      : structuredClone(DEFAULT_RECORDS[key])
  ]));
}

function writeBackup(storage, envelope) {
  const namespace = envelope.namespace;
  const currentKey = backupStorageKey(namespace, 'current');
  const previousKey = backupStorageKey(namespace, 'previous');
  const candidates = [
    envelope,
    parseStoredEnvelope(storage, currentKey),
    parseStoredEnvelope(storage, previousKey)
  ]
    .map(candidate => decodeEnvelope(candidate, namespace))
    .filter(Boolean)
    .sort((left, right) => right.generation - left.generation || right.savedAt - left.savedAt)
    .filter((candidate, index, list) => list.findIndex(item => item.generation === candidate.generation) === index);
  const nextCurrent = candidates[0];
  const nextPrevious = candidates[1] || null;
  let previousRaw = null;
  try {
    previousRaw = storage.getItem(previousKey);
    if (nextPrevious) storage.setItem(previousKey, JSON.stringify(nextPrevious));
    else storage.removeItem(previousKey);
    storage.setItem(currentKey, JSON.stringify(nextCurrent));
    return true;
  } catch (error) {
    try {
      if (previousRaw == null) storage.removeItem(previousKey);
      else storage.setItem(previousKey, previousRaw);
    } catch { /* Preserve the current generation even if localStorage cannot roll back rotation. */ }
    guard.lastError = String(error?.name || error || 'backup write failed');
    return false;
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function runIndexedDbTransaction(db, mode, worker) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(KV_STORE, mode);
    } catch (error) {
      reject(error);
      return;
    }
    const objectStore = transaction.objectStore(KV_STORE);
    const store = {
      get: key => requestResult(objectStore.get(key)),
      put: (value, key) => requestResult(objectStore.put(value, key)),
      delete: key => requestResult(objectStore.delete(key))
    };
    let result;
    let failure;
    transaction.oncomplete = () => failure ? reject(failure) : resolve(result);
    transaction.onerror = () => reject(failure || transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(failure || transaction.error || new Error('IndexedDB transaction aborted'));
    Promise.resolve()
      .then(() => worker(store))
      .then(value => { result = value; })
      .catch(error => {
        failure = error;
        try { transaction.abort(); } catch { reject(error); }
      });
  });
}

function openDatabase(indexedDb) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDb.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb open failed'));
    request.onblocked = () => reject(new Error('indexeddb open blocked'));
  });
}

function runtimeEnvironment() {
  const seam = globalThis.__EARTH_RADIO_STORAGE_GUARD_TEST__;
  return {
    seam,
    indexedDB: seam?.indexedDB ?? globalThis.indexedDB,
    localStorage: seam?.localStorage ?? globalThis.localStorage,
    sessionStorage: seam?.sessionStorage ?? globalThis.sessionStorage,
    location: seam?.location ?? globalThis.location,
    window: seam?.window ?? globalThis.window,
    document: seam?.document ?? globalThis.document,
    // Wrapped, never detached: calling a bare `window.setInterval` reference with an
    // undefined `this` throws "Illegal invocation" in browsers (the unit-test seam
    // masks this, so only the real page would break).
    setInterval: seam?.setInterval ?? ((...timerArgs) => globalThis.setInterval(...timerArgs)),
    now: seam?.now ?? Date.now,
    openDb: seam?.openDb ?? (() => openDatabase(globalThis.indexedDB)),
    transact: seam?.transact ?? runIndexedDbTransaction
  };
}

async function readStartupState(db, env) {
  return env.transact(db, 'readonly', async store => {
    const records = {};
    for (const key of USER_KEYS) records[key] = await store.get(key);
    const accountId = await store.get(ACTIVE_NAMESPACE_KEY);
    const marker = await store.get(PRIMARY_GENERATION_KEY);
    return { records, accountId: accountId || null, marker };
  });
}

function attemptKey(namespace, generation) {
  return `${RESTORE_ATTEMPT_PREFIX}:${encodeURIComponent(namespace)}:${generation}`;
}

function readAttempts(storage, namespace, generation) {
  try {
    return Number(storage.getItem(attemptKey(namespace, generation))) || 0;
  } catch {
    return 99;
  }
}

async function restoreBackup(db, env, namespace, backup) {
  const attempts = readAttempts(env.sessionStorage, namespace, backup.generation);
  if (!shouldRestore({ primaryGeneration: '', backup, restoreAttempts: attempts })) return false;
  const records = completeRecords(backup.data);
  const envelope = backup.legacy
    ? buildEnvelope({ namespace, generation: backup.generation, savedAt: backup.savedAt, data: records })
    : null;
  try {
    await env.transact(db, 'readwrite', async store => {
      const accountId = await store.get(ACTIVE_NAMESPACE_KEY);
      if (namespaceForAccount(accountId || null) !== namespace) throw new Error('Account changed during storage restore');
      if (envelope && !writeBackup(env.localStorage, envelope)) throw new Error('Legacy backup migration failed');
      for (const key of USER_KEYS) await store.put(records[key], key);
      await store.put(primaryMarker(namespace, backup.generation, backup.savedAt), PRIMARY_GENERATION_KEY);
    });
  } catch (error) {
    guard.lastError = String(error?.message || error || 'restore failed');
    return false;
  }
  try {
    env.sessionStorage.setItem(attemptKey(namespace, backup.generation), String(attempts + 1));
  } catch (error) {
    guard.lastError = String(error?.name || error || 'restore accounting failed');
  }
  if (backup.legacy) {
    for (const key of LEGACY_BACKUP_KEYS) {
      try { env.localStorage.removeItem(key); } catch { /* Retaining v1 is safe. */ }
    }
  }
  guard.restored = true;
  guard.hasBackup = true;
  // The runtime bundle keeps executing between this commit and the reload actually
  // tearing the page down; a late default-prefs write in that gap would survive under
  // the now-valid marker. Stash the committed records so the next boot re-applies
  // them ahead of every runtime read/write (the guard module evaluates first, so its
  // transaction enters the IndexedDB queue first).
  try {
    env.sessionStorage.setItem(RESTORE_REAPPLY_KEY, JSON.stringify({
      namespace,
      generation: backup.generation,
      savedAt: backup.savedAt,
      data: records
    }));
  } catch { /* the committed restore still stands without the re-apply layer */ }
  env.location.reload();
  return { committed: true };
}

function readReapplyRecord(env) {
  try {
    const raw = env.sessionStorage.getItem(RESTORE_REAPPLY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.data !== 'object') {
      // Malformed records can never become applicable; drop them immediately.
      env.sessionStorage.removeItem(RESTORE_REAPPLY_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function reapplyRestoredRecords(env, record) {
  try {
    const db = await env.openDb();
    await env.transact(db, 'readwrite', async store => {
      const accountId = await store.get(ACTIVE_NAMESPACE_KEY);
      if (namespaceForAccount(accountId || null) !== record.namespace) return;
      for (const key of USER_KEYS) await store.put(record.data[key], key);
      await store.put(primaryMarker(record.namespace, record.generation, record.savedAt), PRIMARY_GENERATION_KEY);
    });
    // Drop the record only after the corrective transaction committed (or the
    // namespace moved on, making it permanently inapplicable). A transient open or
    // commit failure keeps it in sessionStorage so the next boot retries instead of
    // snapshotting the stale primary values under the still-valid marker.
    try {
      env.sessionStorage.removeItem(RESTORE_REAPPLY_KEY);
    } catch { /* removal is best-effort; a duplicate re-apply is idempotent */ }
  } catch { /* transient failure: retain the record for the next boot's retry */ }
}

async function snapshot(db, env, { allowInitialize = false } = {}) {
  try {
    const committed = await env.transact(db, 'readwrite', async store => {
      const records = {};
      for (const key of USER_KEYS) records[key] = await store.get(key);
      const accountId = await store.get(ACTIVE_NAMESPACE_KEY);
      const marker = await store.get(PRIMARY_GENERATION_KEY);
      const namespace = namespaceForAccount(accountId || null);
      const hasValidMarker = markerIsValid(marker, namespace);
      if (!hasValidMarker && !allowInitialize) return null;
      const generation = hasValidMarker ? marker.generation + 1 : 1;
      const savedAt = env.now();
      const envelope = buildEnvelope({ namespace, generation, savedAt, data: completeRecords(records) });
      if (!writeBackup(env.localStorage, envelope)) throw new Error('Backup rotation failed');
      await store.put(primaryMarker(namespace, generation, savedAt), PRIMARY_GENERATION_KEY);
      return envelope;
    });
    guard.hasBackup = Boolean(committed);
    return Boolean(committed);
  } catch (error) {
    guard.lastError = String(error?.message || error || 'snapshot failed');
    return false;
  }
}

function guardStatus() {
  return {
    enabled: guard.enabled,
    restored: guard.restored,
    lastError: guard.lastError,
    hasBackup: guard.hasBackup
  };
}

function installRuntimeHooks(db, env) {
  env.setInterval(() => { if (!env.document.hidden) void snapshot(db, env); }, SNAPSHOT_INTERVAL_MS);
  env.document.addEventListener('visibilitychange', () => { if (env.document.hidden) void snapshot(db, env); });
  env.window.addEventListener('pagehide', () => void snapshot(db, env));
  env.window.earthRadioStorageGuard = Object.freeze({
    version: '2.0.0',
    snapshotNow: () => snapshot(db, env),
    status: guardStatus
  });
}

async function start(env) {
  let db;
  try {
    db = await env.openDb();
  } catch (error) {
    guard.enabled = false;
    guard.lastError = String(error?.name || error || 'indexeddb unavailable');
    return;
  }

  let startup;
  try {
    startup = await readStartupState(db, env);
  } catch (error) {
    guard.enabled = false;
    guard.lastError = String(error?.message || error || 'startup snapshot failed');
    return;
  }
  const namespace = namespaceForAccount(startup.accountId);
  if (!markerIsValid(startup.marker, namespace)) {
    let backup = readBestV2Backup(env.localStorage, namespace);
    if (!backup && namespace === 'default') backup = readBestV1Backup(env.localStorage);
    if (backup) {
      guard.hasBackup = true;
      const attempts = readAttempts(env.sessionStorage, namespace, backup.generation);
      if (shouldRestore({ primaryGeneration: '', backup, restoreAttempts: attempts })) {
        const restored = await restoreBackup(db, env, namespace, backup);
        if (restored?.committed) return;
        if (guard.lastError) return;
      } else {
        return;
      }
    }
  }

  await snapshot(db, env, { allowInitialize: true });
  installRuntimeHooks(db, env);
}

const env = runtimeEnvironment();
if (env.seam) env.seam.status = guardStatus;
if (!env.indexedDB) {
  guard.enabled = false;
} else {
  // Post-restore boots re-commit the restored records before anything else touches
  // the store: this open/transaction is issued during module evaluation, ahead of the
  // runtime bundle, so any stale value written in the previous boot's commit-to-reload
  // gap is overwritten before the runtime hydrates.
  const reapplyRecord = readReapplyRecord(env);
  if (reapplyRecord) void reapplyRestoredRecords(env, reapplyRecord);
  const startPromise = start(env);
  if (env.seam) env.seam.startPromise = startPromise;
  void startPromise;
}
