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
const BACKUP_KEY = 'earth-radio-user-backup-v1';
const BACKUP_PREV_KEY = 'earth-radio-user-backup-v1-prev';
const RESTORE_FLAG_KEY = 'earth-radio-user-restore-attempted-v1';
const SNAPSHOT_INTERVAL_MS = 20 * 1000;

const guard = {
  enabled: true,
  lastSerialized: '',
  restored: false,
  lastError: ''
};

function checksum(text) {
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
  return new Promise(resolve => {
    try {
      const transaction = db.transaction(KV_STORE, 'readwrite');
      transaction.objectStore(KV_STORE).put(value, key);
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
    if (!parsed || parsed.v !== 1 || typeof parsed.payload !== 'string') return null;
    if (checksum(parsed.payload) !== parsed.checksum) return null;
    const data = JSON.parse(parsed.payload);
    if (!data || typeof data !== 'object') return null;
    return { savedAt: Number(parsed.savedAt) || 0, data };
  } catch {
    return null;
  }
}

function readBestBackup() {
  return readBackup(BACKUP_KEY) || readBackup(BACKUP_PREV_KEY);
}

// "Substance" = records the user would miss: favorites, listening history, last station.
// Default preferences written at first boot do not count, so a store that lost user data
// still reads as empty even if the runtime already re-seeded defaults.
function hasUserSubstance(data) {
  if (!data) return false;
  const favorites = data.favorites;
  const recents = data.recents;
  return (favorites && typeof favorites === 'object' && Object.keys(favorites).length > 0) ||
    (Array.isArray(recents) && recents.length > 0) ||
    data.lastPlayed != null;
}

function writeBackup(data) {
  const payload = JSON.stringify(data);
  if (payload === guard.lastSerialized) return;
  try {
    // Keep the previous good generation so a torn write of the primary never loses both.
    const current = localStorage.getItem(BACKUP_KEY);
    if (current && readBackup(BACKUP_KEY)) localStorage.setItem(BACKUP_PREV_KEY, current);
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), checksum: checksum(payload), payload }));
    guard.lastSerialized = payload;
  } catch (error) {
    guard.lastError = String(error?.name || error || 'backup write failed');
  }
}

async function snapshot(db) {
  const { data, present } = await readUserRecords(db);
  // A totally empty read means the store is gone (fresh profile or data loss), not that
  // the user cleared everything; never overwrite a good backup with that.
  if (present === 0) return false;
  writeBackup(data);
  return true;
}

function restoreAttempts() {
  try {
    return Number(sessionStorage.getItem(RESTORE_FLAG_KEY)) || 0;
  } catch {
    return 99;
  }
}

async function restoreIfLost(db) {
  const { data } = await readUserRecords(db);
  if (hasUserSubstance(data)) {
    // Healthy boot: clear any pending restore accounting from a prior recovery.
    try { sessionStorage.removeItem(RESTORE_FLAG_KEY); } catch { /* best effort */ }
    return false;
  }
  const backup = readBestBackup();
  if (!backup || !hasUserSubstance(backup.data)) return false;
  // At most two attempts per tab session so a hostile write path can never reload-loop.
  const attempts = restoreAttempts();
  if (attempts >= 2) return false;
  try {
    sessionStorage.setItem(RESTORE_FLAG_KEY, String(attempts + 1));
  } catch {
    return false;
  }

  // The runtime may be seeding initial empty records concurrently at first boot; write
  // twice with a gap so the restored records win regardless of interleaving.
  let wrote = false;
  for (let round = 0; round < 2; round += 1) {
    for (const key of USER_KEYS) {
      if (backup.data[key] === undefined) continue;
      if (await idbSet(db, key, backup.data[key])) wrote = true;
    }
    if (round === 0) await new Promise(resolve => setTimeout(resolve, 350));
  }
  if (!wrote) return false;
  guard.restored = true;
  // The runtime hydrates user records once at boot and may already have read the empty
  // store; a guarded reload lets it boot from the restored records.
  location.reload();
  return true;
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
