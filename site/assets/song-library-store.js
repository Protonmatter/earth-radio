import {
  emptySongLibrary, normalizeSongLibrary, encodeSongEnvelope, decodeSongEnvelope,
  songNamespaceKey, songSyncStateKey, addSongsFromLibrary
} from './song-library-core.js?v=0.33.0';

// The supported auth adapter selects the tab's identity. IndexedDB independently
// verifies it in every transaction; another tab changing account cannot redirect
// an in-flight write. No session credential is read or stored by this module.
let account = { ready: false, accountId: null, version: 0 };
const accountListeners = new Set();
const namespaceOf = id => id ? `account:${encodeURIComponent(id)}` : 'default';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function notify(listeners) {
  for (const listener of listeners) {
    try { listener(); } catch { console.warn('Earth Radio song library view could not refresh.'); }
  }
}
export function setSongLibraryAccount(accountId) {
  const id = typeof accountId === 'string' && accountId ? accountId : null;
  if (account.ready && account.accountId === id) return;
  account = { ready: true, accountId: id, version: account.version + 1 }; notify(accountListeners);
}
export function pauseSongLibraryAccount() {
  account = { ...account, ready: false, version: account.version + 1 }; notify(accountListeners);
}
export const getSongLibraryAccount = () => ({ ...account });
export function subscribeSongLibraryAccount(listener) { accountListeners.add(listener); return () => accountListeners.delete(listener); }

function privateRemoval(before, after) {
  if (!before) return false;
  if (!after || after.historyEpoch > before.historyEpoch || (before.historyEnabled && !after.historyEnabled)) return true;
  return Object.entries(before.tracks).some(([id, row]) => row.liked && !after.tracks[id]?.liked || row.heardAt && !after.tracks[id]?.heardAt);
}
const rawTag = raw => raw === undefined ? 'missing' : JSON.stringify(['version', 'namespace', 'generation', 'savedAt', 'checksum', 'payload']
  .map(key => typeof raw?.[key] === 'string' || typeof raw?.[key] === 'number' ? raw[key] : null));

export function createSongLibraryStore({ indexedDBImpl = globalThis.indexedDB,
  storage = () => { try { return globalThis.localStorage; } catch { return null; } },
  getAccount = getSongLibraryAccount, now = Date.now, channel = null } = {}) {
  const listeners = new Set(); let backupAvailable = true;
  const storageObject = () => { try { return typeof storage === 'function' ? storage() : storage; } catch { return null; } };
  const changed = (broadcast = true) => { notify(listeners); if (broadcast) channel?.postMessage({ changed: true }); };
  if (channel) channel.onmessage = () => changed(false);
  const storageChanged = event => { if (event.key?.startsWith('earth-radio-songs-v1:')) changed(false); };
  if (typeof window !== 'undefined') window.addEventListener('storage', storageChanged);
  const token = accountId => {
    const owner = getAccount();
    if (!owner.ready) throw failure('LIBRARY_NOT_READY', 'Song library account is not ready.');
    if (accountId !== undefined && owner.accountId !== accountId) throw failure('ACCOUNT_CHANGED', 'Account changed while saving songs.');
    return { ...owner, namespace: namespaceOf(owner.accountId) };
  };
  function assertToken(expected) {
    const current = getAccount();
    if (!current.ready || current.version !== expected.version || current.accountId !== expected.accountId) throw failure('ACCOUNT_CHANGED', 'Account changed while saving songs.');
  }
  function open() {
    return new Promise((resolve, reject) => {
      if (!indexedDBImpl) { reject(failure('LIBRARY_STORAGE', 'Song storage is unavailable.')); return; }
      let request, failed = false;
      const stop = error => { failed = true; clearTimeout(timer); reject(error); };
      const timer = setTimeout(() => stop(failure('LIBRARY_STORAGE', 'Song storage did not open.')), 8000);
      try {
        request = indexedDBImpl.open('earthRadio', 1);
        request.onupgradeneeded = () => {
          for (const name of ['kv', 'cache']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        };
        request.onsuccess = () => { clearTimeout(timer); if (failed) request.result.close(); else resolve(request.result); };
        request.onerror = () => stop(failure('LIBRARY_STORAGE', 'Song storage could not be opened.'));
        request.onblocked = () => stop(failure('LIBRARY_STORAGE', 'Close other Earth Radio windows and retry song storage.'));
      } catch { stop(failure('LIBRARY_STORAGE', 'Song storage is unavailable.')); }
    });
  }
  async function transact(expected, mode, work) {
    assertToken(expected); const db = await open();
    try {
      assertToken(expected);
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode), store = tx.objectStore('kv');
        let result, error, settled = false;
        const timer = setTimeout(() => abort(failure('LIBRARY_STORAGE', 'Song storage did not finish.')), 8000);
        const abort = reason => { error = reason; try { tx.abort(); } catch { clearTimeout(timer); if (!settled) reject(error); } };
        tx.oncomplete = () => { settled = true; clearTimeout(timer); resolve(result); };
        tx.onerror = tx.onabort = () => { settled = true; clearTimeout(timer); reject(error || failure('LIBRARY_STORAGE', 'Songs could not be saved.')); };
        const active = store.get('account:active');
        active.onerror = () => abort(failure('LIBRARY_STORAGE', 'The account namespace could not be read.'));
        active.onsuccess = () => {
          try {
            assertToken(expected);
            if (namespaceOf(active.result || null) !== expected.namespace) throw failure('ACCOUNT_CHANGED', 'Account changed while saving songs.');
            work(store, value => { result = value; }, abort);
          } catch (reason) { abort(reason); }
        };
      });
    } finally { db.close(); }
  }
  function mirror(envelope, forgetPrior = false) {
    const target = storageObject(), key = songNamespaceKey(envelope.namespace);
    if (!target) { backupAvailable = false; return; }
    try {
      if (forgetPrior) { target.removeItem(`${key}:backup`); target.removeItem(`${key}:previous`); }
      const previous = target.getItem(`${key}:backup`);
      target.setItem(`${key}:backup`, JSON.stringify(envelope));
      if (forgetPrior) target.setItem(`${key}:previous`, JSON.stringify(envelope));
      else if (previous) target.setItem(`${key}:previous`, previous);
      backupAvailable = true;
    } catch { backupAvailable = false; }
  }
  function backup(namespace, privacyFloor = 0) {
    const target = storageObject(), key = songNamespaceKey(namespace), candidates = [];
    for (const suffix of [':backup', ':previous']) {
      try { const raw = JSON.parse(target?.getItem(key + suffix) || 'null'), decoded = decodeSongEnvelope(raw, namespace); if (decoded && decoded.generation >= privacyFloor) candidates.push({ raw, decoded }); }
      catch { /* An invalid copy is preserved; it never becomes another account's data. */ }
    }
    return candidates.sort((a, b) => b.decoded.generation - a.decoded.generation || b.decoded.savedAt - a.decoded.savedAt)[0];
  }
  function decode(raw, namespace) {
    if (raw?.namespace === namespace && typeof raw.payload === 'string' && raw.payload.length <= 1048576) {
      try { if (JSON.parse(raw.payload)?.version > 1) throw failure('LIBRARY_UPDATE_REQUIRED', 'Update Earth Radio to open these songs.'); }
      catch (error) { if (error.code === 'LIBRARY_UPDATE_REQUIRED') throw error; }
    }
    const decoded = decodeSongEnvelope(raw, namespace);
    if (raw !== undefined && !decoded) throw failure('LIBRARY_CORRUPT', 'The saved song library could not be read.');
    return decoded;
  }
  async function rawSnapshot(expected) {
    return transact(expected, 'readonly', (store, done, abort) => {
      const keys = [songNamespaceKey(expected.namespace), songSyncStateKey(expected.namespace), `${songNamespaceKey(expected.namespace)}:privacy`], values = [];
      let remaining = keys.length;
      keys.forEach((key, index) => { const request = store.get(key); request.onerror = () => abort(failure('LIBRARY_STORAGE', 'Songs could not be read.'));
        request.onsuccess = () => { values[index] = request.result; if (--remaining === 0) {
          if (values[2] !== undefined && (!Number.isSafeInteger(values[2]) || values[2] < 1)) { abort(failure('LIBRARY_CORRUPT', 'The song privacy marker could not be read.')); return; }
          done({ raw: values[0], state: values[1], privacyFloor: values[2] || 0 });
        } }; });
    });
  }
  async function load(expected) {
    let current = await rawSnapshot(expected), decoded;
    try { decoded = decode(current.raw, expected.namespace); }
    catch (error) { if (error.code !== 'LIBRARY_CORRUPT') throw error; }
    if (decoded) return { ...current, decoded };
    const copy = backup(expected.namespace, current.privacyFloor);
    if (!copy && current.raw !== undefined) throw failure('LIBRARY_CORRUPT', 'The saved song library could not be read. Try account sync or restore a saved copy.');
    if (copy) {
      const key = songNamespaceKey(expected.namespace);
      const restored = encodeSongEnvelope(expected.namespace, Math.max(copy.decoded.generation, Number(current.raw?.generation) || 0) + 1, copy.decoded.value, now());
      const applied = await transact(expected, 'readwrite', (store, done, abort) => {
        const request = store.get(key); request.onsuccess = () => {
          try {
            if (rawTag(request.result) !== rawTag(current.raw)) { done(false); return; }
            if (request.result !== undefined) store.put(request.result, `${key}:damaged`);
            store.put(restored, key); store.delete(songSyncStateKey(expected.namespace)); done(true);
          } catch (error) { abort(error); }
        };
      });
      if (!applied) throw failure('LIBRARY_CHANGED', 'Songs changed while restoring; retry.');
      await publishBackup(expected, restored); changed(); current = await rawSnapshot(expected); decoded = decode(current.raw, expected.namespace);
    } else if (current.state?.value !== undefined) {
      // A missing local row is storage loss, not an explicit cloud deletion.
      // Forget the baseline so the next sync downloads rather than deletes it.
      await transact(expected, 'readwrite', (store, done) => {
        const read = store.get(songNamespaceKey(expected.namespace)); read.onsuccess = () => {
          if (read.result !== undefined) { done(false); return; }
          const state = store.get(songSyncStateKey(expected.namespace)); state.onsuccess = () => {
            if (equal(state.result, current.state)) store.delete(songSyncStateKey(expected.namespace)); done(true);
          };
        };
      });
      current = await rawSnapshot(expected);
    }
    return { ...current, decoded };
  }
  async function publishBackup(expected, envelope, forgetPrior = false) {
    // This second read/write transaction serializes publication with every other
    // writer across tabs. A delayed completion may publish only the still-current
    // primary generation; localStorage work stays synchronous while holding it.
    await transact(expected, 'readwrite', (store, done, abort) => {
      const read = store.get(songNamespaceKey(expected.namespace)); read.onsuccess = () => {
        try { if (rawTag(read.result) === rawTag(envelope)) mirror(envelope, forgetPrior); done(true); }
        catch (error) { abort(error); }
      };
    });
  }
  async function replace(expected, transform, { compare, requireCloudReady = false } = {}) {
    await load(expected); const key = songNamespaceKey(expected.namespace);
    const result = await transact(expected, 'readwrite', (store, done, abort) => {
      const privacy = store.get(`${key}:privacy`), read = store.get(key); read.onsuccess = () => {
        try {
          const decoded = decode(read.result, expected.namespace), before = decoded?.value;
          if (compare && !equal(before, compare.expected)) { done({ matched: false }); return; }
          const apply = () => {
            try {
              const after = transform(before), normalized = after === undefined ? undefined : normalizeSongLibrary(after);
              if (equal(before, normalized)) { done({ matched: true, value: before, changed: false }); return; }
              const envelope = encodeSongEnvelope(expected.namespace, Math.max(decoded?.generation || 0, privacy.result || 0) + 1, normalized, now());
              const forgetPrior = privateRemoval(before, normalized);
              store.put(envelope, key); if (forgetPrior) { store.put(envelope.generation, `${key}:privacy`); store.delete(`${key}:damaged`); }
              done({ matched: true, value: normalized, changed: true, envelope, forgetPrior });
            } catch (error) { abort(error); }
          };
          if (requireCloudReady && expected.accountId) {
            const state = store.get(songSyncStateKey(expected.namespace));
            state.onsuccess = () => state.result ? apply() : abort(failure('LIBRARY_SYNC_PENDING', 'Wait for account song sync before saving.'));
          } else apply();
        } catch (error) { abort(error); }
      };
    });
    if (result.changed) { await publishBackup(expected, result.envelope, result.forgetPrior); changed(); }
    return result;
  }
  const api = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async read() {
      const expected = token(), snapshot = await load(expected); assertToken(expected);
      return { namespace: expected.namespace, ownerVersion: expected.version, value: snapshot.decoded?.value,
        generation: snapshot.decoded?.generation || 0, canWrite: !expected.accountId || Boolean(snapshot.state), backupAvailable };
    },
    async mutate(transform, ownerVersion = getAccount().version) {
      const expected = token(); if (expected.version !== ownerVersion) throw failure('ACCOUNT_CHANGED', 'Account changed while saving songs.');
      return (await replace(expected, before => transform(before ?? emptySongLibrary()), { requireCloudReady: true })).value;
    },
    async readForAccount(accountId) { return (await load(token(accountId))).decoded?.value; },
    async compareForAccount(accountId, expected, value) { return (await replace(token(accountId), () => value, { compare: { expected } })).matched; },
    async writeForAccount(accountId, value) { return (await replace(token(accountId), () => value)).value; },
    async readSyncState(accountId) { return (await rawSnapshot(token(accountId))).state; },
    async writeSyncState(accountId, value) {
      const expected = token(accountId);
      await transact(expected, 'readwrite', (store, done) => { store.put(value, songSyncStateKey(expected.namespace)); done(true); }); changed();
    },
    async ensureSyncBaseline(accountId) {
      const expected = token(accountId);
      const written = await transact(expected, 'readwrite', (store, done) => {
        const state = store.get(songSyncStateKey(expected.namespace)); state.onsuccess = () => {
          if (state.result !== undefined) { done(false); return; }
          store.put({ revision: 0, hash: 'undefined', value: undefined }, songSyncStateKey(expected.namespace)); done(true);
        };
      });
      if (written) changed();
    },
    async guestSongsAvailable() {
      const expected = token(); if (!expected.accountId) return false;
      return transact(expected, 'readonly', (store, done, abort) => {
        const guest = store.get(songNamespaceKey('default')), own = store.get(songNamespaceKey(expected.namespace));
        own.onsuccess = () => {
          try {
          const source = decodeSongEnvelope(guest.result, 'default')?.value;
          const destination = decode(own.result, expected.namespace)?.value;
          done(Boolean(source && Object.entries(source.tracks).some(([id, row]) => row.liked && !destination?.tracks[id]?.liked
            || row.heardAt > (destination?.tracks[id]?.heardAt || 0) && destination?.historyEnabled !== false)));
          } catch (error) { abort(error); }
        };
      });
    },
    async importGuest(ownerVersion) {
      const expected = token(); if (!expected.accountId || expected.version !== ownerVersion) throw failure('ACCOUNT_CHANGED', 'Account changed while adding local songs.');
      const guest = await transact(expected, 'readonly', (store, done, abort) => {
        const read = store.get(songNamespaceKey('default')); read.onsuccess = () => {
          try { done(decodeSongEnvelope(read.result, 'default')?.value); } catch (error) { abort(error); }
        };
      });
      if (!guest) return undefined;
      return api.mutate(current => addSongsFromLibrary(current, guest), ownerVersion);
    },
    dispose() { listeners.clear(); channel?.close(); if (typeof window !== 'undefined') window.removeEventListener('storage', storageChanged); }
  };
  return api;
}

let singleton;
export function songLibraryStore() {
  if (!singleton) {
    let channel = null;
    try { if (typeof window !== 'undefined' && typeof BroadcastChannel === 'function') channel = new BroadcastChannel('earth-radio-song-library-v1'); } catch { /* local notifications remain available */ }
    singleton = createSongLibraryStore({ channel });
    if (typeof window !== 'undefined') window.addEventListener('pagehide', event => { if (!event.persisted) singleton?.dispose(); });
  }
  return singleton;
}
