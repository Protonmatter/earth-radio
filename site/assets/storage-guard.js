// Earth Radio user-storage guard v1.0.0
// User-level records (favorites, recents, preferences, last played, playback penalties)
// live in IndexedDB, where writes fail silently under quota pressure, private windows,
// or profile eviction. This overlay mirrors those records into a checksummed
// localStorage backup and restores them when the primary store is lost or corrupted.
// Loaded before the runtime bundle; fully additive.

const DB_NAME = 'earthRadio';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const USER_KEYS = ['favorites', 'recents', 'prefs', 'badStations', 'lastPlayed'];
// Generation marker: proof that the primary store's current contents are intentional.
// Only the guard writes it; a wiped/evicted store loses it together with the data,
// while an intentional clear keeps a valid marker — so loss is proven, never inferred
// from empty application data.
const GUARD_META_KEY = 'earthRadioGuard:meta';
// Backup identity is scoped to the active account (PR #7 sync): a backup captured
// under one account must never restore into another account's working keys. Signed-out
// sessions use the 'default' namespace.
const ACTIVE_USER_KEY = 'earthRadio.auth.activeUser.v1';

function activeNamespace() {
  try {
    const id = localStorage.getItem(ACTIVE_USER_KEY);
    return id ? `account:${id}` : 'default';
  } catch {
    return 'default';
  }
}
const BACKUP_KEY = 'earth-radio-user-backup-v2';
const BACKUP_PREV_KEY = 'earth-radio-user-backup-v2-prev';

// Each account namespace owns its own current/previous backup generations: sharing
// two global keys would let account B's snapshots rotate account A's generations
// away, leaving A unrestorable after eviction. The signed-out 'default' namespace
// keeps the legacy unsuffixed keys so pre-existing backups stay readable. Exported
// for unit tests.
export function backupStorageKeys(namespace) {
  const suffix = namespace && namespace !== 'default' ? `:${namespace}` : '';
  return { current: `${BACKUP_KEY}${suffix}`, previous: `${BACKUP_PREV_KEY}${suffix}` };
}
const RESTORE_FLAG_KEY = 'earth-radio-user-restore-attempted-v1';
const SNAPSHOT_INTERVAL_MS = 20 * 1000;

const guard = {
  enabled: true,
  lastSerialized: '',
  restored: false,
  lastError: ''
};

export function checksum(text) {
  // FNV-1a: cheap, synchronous, good enough to detect torn/corrupted JSON writes.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function openDb() {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      // Mirror the runtime's schema so whichever side opens first creates the same stores.
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb open failed'));
    request.onblocked = () => reject(new Error('indexeddb open blocked'));
  });
}

function idbGet(db, key) {
  return new Promise(resolve => {
    try {
      const request = db.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

function idbSet(db, key, value) {
  return idbSetMany(db, [[key, value]]);
}

// All entries commit in ONE readwrite transaction: a restore must never leave the
// store half-written with data from one generation and a marker from another.
function idbSetMany(db, entries) {
  return new Promise(resolve => {
    try {
      const transaction = db.transaction(KV_STORE, 'readwrite');
      const store = transaction.objectStore(KV_STORE);
      for (const [key, value] of entries) store.put(value, key);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function readUserRecords(db) {
  const data = {};
  let present = 0;
  for (const key of USER_KEYS) {
    const value = await idbGet(db, key);
    if (value !== undefined) {
      data[key] = value;
      present += 1;
    }
  }
  return { data, present };
}

function readBackup(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 2 || typeof parsed.payload !== 'string') return null;
    if (parsed.namespace !== activeNamespace()) return null;
    if (checksum(parsed.payload) !== parsed.checksum) return null;
    const data = JSON.parse(parsed.payload);
    if (!data || typeof data !== 'object') return null;
    return { generation: Number(parsed.generation) || 0, committedAt: Number(parsed.committedAt) || 0, data };
  } catch {
    return null;
  }
}

function isValidGuardMeta(meta) {
  return Boolean(meta && meta.schemaVersion === 1 && Number.isFinite(Number(meta.generation)) &&
    Number(meta.generation) > 0 && meta.namespace === activeNamespace());
}

function readBestBackup() {
  const keys = backupStorageKeys(activeNamespace());
  return readBackup(keys.current) || readBackup(keys.previous);
}

// "Substance" = records the user would miss: favorites, listening history, last station.
// Default preferences written at first boot do not count, so a store that lost user data
// still reads as empty even if the runtime already re-seeded defaults.
export function hasUserSubstance(data) {
  if (!data) return false;
  const favorites = data.favorites;
  const recents = data.recents;
  return (favorites && typeof favorites === 'object' && Object.keys(favorites).length > 0) ||
    (Array.isArray(recents) && recents.length > 0) ||
    data.lastPlayed != null;
}

function writeBackup(data, generation) {
  const payload = JSON.stringify(data);
  if (payload === guard.lastSerialized) return;
  try {
    const keys = backupStorageKeys(activeNamespace());
    // Keep the previous good generation so a torn write of the primary never loses both.
    const current = localStorage.getItem(keys.current);
    if (current && readBackup(keys.current)) localStorage.setItem(keys.previous, current);
    localStorage.setItem(keys.current, JSON.stringify({
      v: 2,
      schemaVersion: 1,
      namespace: activeNamespace(),
      generation,
      committedAt: Date.now(),
      checksum: checksum(payload),
      payload
    }));
    guard.lastSerialized = payload;
  } catch (error) {
    guard.lastError = String(error?.name || error || 'backup write failed');
  }
}

// Every intentional snapshot — including an empty state after the user clears their
// data — advances the generation marker and writes a checksummed backup. A missing
// marker means the store's contents are unproven (mid-session wipe): skip, so the
// backup is never overwritten by unproven state, and the next boot restores.
async function snapshot(db) {
  const meta = await idbGet(db, GUARD_META_KEY);
  if (!isValidGuardMeta(meta)) return false;
  const { data } = await readUserRecords(db);
  const generation = Number(meta.generation) + 1;
  const nextMeta = { schemaVersion: 1, generation, committedAt: Date.now(), namespace: activeNamespace() };
  if (!(await idbSet(db, GUARD_META_KEY, nextMeta))) return false;
  writeBackup(data, generation);
  return true;
}

function restoreAttempts() {
  try {
    return Number(sessionStorage.getItem(RESTORE_FLAG_KEY)) || 0;
  } catch {
    return 99;
  }
}

// The whole restore-or-not decision, pure and exported for direct unit testing.
// A present primary generation proves the store's current contents — including
// intentionally emptied favorites/recents — are authoritative, so no backup may
// overwrite them. Restoration happens only when the marker is gone (real loss or
// eviction), a decodable backup exists, and the per-tab-session attempt cap has
// not been reached.
export function shouldRestore({ primaryGeneration, backup, restoreAttempts: attempts = 0 }) {
  if (primaryGeneration) return false;
  if (!backup || typeof backup !== 'object' || !backup.data || typeof backup.data !== 'object') return false;
  return Number(attempts) < 2;
}

async function restoreIfLost(db) {
  const meta = await idbGet(db, GUARD_META_KEY);
  const primaryGeneration = isValidGuardMeta(meta) ? String(meta.generation) : '';
  if (primaryGeneration) {
    // A valid generation marker proves the primary contents are intentional — even an
    // empty state after the user cleared their data is authoritative and must never be
    // overwritten by a stale backup.
    try { sessionStorage.removeItem(RESTORE_FLAG_KEY); } catch { /* best effort */ }
    return false;
  }

  const backup = readBestBackup();
  if (!backup) {
    // Fresh profile (no marker, no backup): establish generation 1 so future
    // snapshots run and future loss is provable.
    await idbSet(db, GUARD_META_KEY, { schemaVersion: 1, generation: 1, committedAt: Date.now(), namespace: activeNamespace() });
    return false;
  }

  // At most two attempts per tab session so a hostile write path can never reload-loop.
  const attempts = restoreAttempts();
  if (!shouldRestore({ primaryGeneration, backup, restoreAttempts: attempts })) return false;
  try {
    sessionStorage.setItem(RESTORE_FLAG_KEY, String(attempts + 1));
  } catch {
    return false;
  }

  // Restore data and the generation marker atomically in one readwrite transaction;
  // a second round covers the runtime concurrently seeding initial empty records at
  // first boot.
  let wrote = false;
  for (let round = 0; round < 2; round += 1) {
    const dataEntries = USER_KEYS
      .filter(key => backup.data[key] !== undefined)
      .map(key => [key, backup.data[key]]);
    const meta = [GUARD_META_KEY, { schemaVersion: 1, generation: Number(backup.generation) || 1, committedAt: Date.now(), namespace: activeNamespace() }];
    if (await idbSetMany(db, [...dataEntries, meta]) && dataEntries.length) wrote = true;
    if (round === 0) await new Promise(resolve => setTimeout(resolve, 350));
  }
  if (!wrote) return false;
  guard.restored = true;
  // Reload only when the restored records change what the app would show.
  if (hasUserSubstance(backup.data)) location.reload();
  return hasUserSubstance(backup.data);
}

async function start() {
  let db;
  try {
    db = await openDb();
  } catch (error) {
    guard.enabled = false;
    guard.lastError = String(error?.name || error || 'indexeddb unavailable');
    return;
  }

  const restoring = await restoreIfLost(db);
  if (restoring) return;

  await snapshot(db);
  setInterval(() => { if (!document.hidden) void snapshot(db); }, SNAPSHOT_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => { if (document.hidden) void snapshot(db); });
  window.addEventListener('pagehide', () => void snapshot(db));

  // Debug/e2e hook; exposes state and an on-demand snapshot, never secrets.
  window.earthRadioStorageGuard = Object.freeze({
    version: '1.0.0',
    snapshotNow: () => snapshot(db),
    status: () => ({ enabled: guard.enabled, restored: guard.restored, lastError: guard.lastError, hasBackup: Boolean(readBestBackup()) })
  });
}

if (typeof indexedDB === 'undefined') {
  guard.enabled = false;
} else {
  void start();
}
