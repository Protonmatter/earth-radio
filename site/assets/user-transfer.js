// Supported async transfer boundary for the recovered runtime. No credentials,
// network access, Blob interception or changes to existing document formats.
import { emptyPassport, normalizePassport, exportPassport, importPassport, addPassportVisits } from './passport-core.js?v=0.35.0';
import { passportStore } from './passport-store.js?v=0.35.0';
import { getSongLibraryAccount } from './song-library-store.js?v=0.35.0';

// Includes the existing 8 MiB favorite / 1 MiB recent / 64 KiB preference
// contracts and formatted JSON overhead. The separate song limit is unrelated.
export const USER_TRANSFER_MAX_BYTES = 32 * 1024 * 1024;
const limits = Object.freeze({ favorites: 8_388_608, recents: 1_048_576, prefs: 65_536 });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const failure = (code, message) => Object.assign(new Error(message), { code });
const invalid = () => failure('TRANSFER_INVALID', 'This file is not a supported Earth Radio export.');
const accountChanged = () => failure('ACCOUNT_CHANGED', 'Account changed during the transfer.');
const namespace = id => id ? `account:${encodeURIComponent(id)}` : 'default';
const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;

export function createUserTransfer({ getAccount = getSongLibraryAccount, passport = passportStore(),
  readLegacy = null, prepareLegacy = null, applyLegacy = null, commitLegacy = null, verifyOwner = null,
  indexedDBImpl = globalThis.indexedDB } = {}) {
  function capture() {
    const owner = getAccount();
    if (!owner?.ready || !Number.isSafeInteger(owner.version) || owner.version < 0
        || owner.accountId !== null && (typeof owner.accountId !== 'string' || !owner.accountId)) throw accountChanged();
    return { ...owner };
  }
  function assertOwner(expected) {
    const owner = capture();
    if (owner.version !== expected.version || owner.accountId !== expected.accountId) throw accountChanged();
  }
  function assertSnapshot(owner, snapshot) {
    assertOwner(owner);
    if (snapshot.ownerVersion !== owner.version || snapshot.namespace !== namespace(owner.accountId)) throw accountChanged();
  }
  async function commit(records, owner, readonly = false) {
    assertOwner(owner);
    if (!readonly && (!plain(records) || Object.keys(records).some(key => !Object.hasOwn(limits, key) || bytes(JSON.stringify(records[key])) > limits[key]))) throw invalid();
    if (!indexedDBImpl) throw failure('TRANSFER_STORAGE', 'Your data could not be saved.');
    const db = await new Promise((resolve, reject) => {
      let request, ended = false;
      const timer = setTimeout(() => { ended = true; reject(failure('TRANSFER_STORAGE', 'Your data could not be saved.')); }, 8000);
      try {
        request = indexedDBImpl.open('earthRadio', 1);
        request.onupgradeneeded = () => { for (const name of ['kv', 'cache']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
        request.onsuccess = () => { clearTimeout(timer); if (ended) request.result.close(); else resolve(request.result); };
        request.onerror = request.onblocked = () => { clearTimeout(timer); ended = true; reject(failure('TRANSFER_STORAGE', 'Your data could not be saved.')); };
      } catch { clearTimeout(timer); reject(failure('TRANSFER_STORAGE', 'Your data could not be saved.')); }
    });
    try {
      assertOwner(owner);
      await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', readonly ? 'readonly' : 'readwrite'), store = tx.objectStore('kv'); let error;
        const timer = setTimeout(() => { error = failure('TRANSFER_STORAGE', 'Your data could not be saved.'); try { tx.abort(); } catch { reject(error); } }, 8000);
        tx.oncomplete = () => { clearTimeout(timer); resolve(); };
        tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(error || failure('TRANSFER_STORAGE', 'Your data could not be saved.')); };
        const active = store.get('account:active');
        active.onsuccess = () => {
          try {
            assertOwner(owner);
            if (namespace(active.result || null) !== namespace(owner.accountId)) throw accountChanged();
            if (!readonly) for (const [key, value] of Object.entries(records)) store.put(value, key);
          } catch (reason) { error = reason; tx.abort(); }
        };
      });
      assertOwner(owner);
    } finally { db.close(); }
  }
  async function ownedSnapshot(owner) {
    const snapshot = await passport.read(); assertSnapshot(owner, snapshot); return snapshot;
  }
  return {
    captureOwner: capture,
    assertOwner,
    async exportData() {
      const owner = capture();
      if (typeof readLegacy !== 'function') throw invalid();
      const legacy = structuredClone(readLegacy());
      if (!plain(legacy) || legacy.schema !== 1) throw invalid();
      const result = { schema: 1, ...(typeof legacy.exportedAt === 'string' ? { exportedAt: legacy.exportedAt } : {}),
        favorites: legacy.favorites, recent: legacy.recent, preferences: legacy.preferences };
      try {
        const snapshot = await ownedSnapshot(owner);
        return { ...result, passport: normalizePassport(snapshot.value || emptyPassport(snapshot.historyEpoch, snapshot.historyClearedAt)) };
      } catch (error) {
        assertOwner(owner);
        if (!['PASSPORT_CORRUPT', 'PASSPORT_UPDATE_REQUIRED', 'PASSPORT_POLICY_UNAVAILABLE', 'PASSPORT_POLICY_PENDING'].includes(error.code)) throw error;
        // A damaged optional document must not remove the existing export path.
        // Independently verify authoritative ownership before returning legacy
        // data, and disclose the omission in both the file and runtime message.
        await (verifyOwner || (expected => commit(null, expected, true)))(owner); assertOwner(owner);
        return { ...result, passportOmitted: true };
      }
    },
    async exportPassportData() {
      const owner = capture(), snapshot = await ownedSnapshot(owner);
      return exportPassport(snapshot.value || emptyPassport(snapshot.historyEpoch, snapshot.historyClearedAt));
    },
    async importFile(file, { passportOnly = false } = {}) {
      const owner = capture();
      if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > USER_TRANSFER_MAX_BYTES || typeof file.text !== 'function') throw invalid();
      // Capture the policy before reading the file. An explicit clear/off while
      // the file picker/read is pending must invalidate this import too.
      let snapshot, snapshotError;
      try { snapshot = await ownedSnapshot(owner); }
      catch (error) { assertOwner(owner); if (error.code === 'ACCOUNT_CHANGED') throw error; snapshotError = error; }
      assertOwner(owner);
      const text = await file.text(); assertOwner(owner);
      if (typeof text !== 'string' || bytes(text) > USER_TRANSFER_MAX_BYTES) throw invalid();
      let payload; try { payload = JSON.parse(text); } catch { throw invalid(); }
      if (!plain(payload)) throw invalid();
      const only = payload.format === 'earth-radio-passport';
      if (passportOnly && !only || !only && (Object.hasOwn(payload, 'format') || Object.hasOwn(payload, 'schema') && payload.schema !== 1)) throw invalid();
      const hasPassport = only || Object.hasOwn(payload, 'passport');
      const hasLegacy = !only && ['favorites', 'recent', 'preferences'].some(key => Object.hasOwn(payload, key));
      if (!hasPassport && !hasLegacy) throw invalid();
      let addition, passportError;
      if (hasPassport) {
        try { addition = only ? importPassport(text) : normalizePassport(payload.passport); }
        catch (error) { passportError = error; }
      }
      let legacy = null;
      if (hasLegacy) {
        if (typeof prepareLegacy !== 'function' || typeof applyLegacy !== 'function') throw invalid();
        const prepared = prepareLegacy(payload);
        if (!plain(prepared) || !plain(prepared.records) || !plain(prepared.report)) throw invalid();
        if (!hasPassport && !Object.values(prepared.report).some(value => Number.isSafeInteger(value) && value > 0)) throw invalid();
        assertOwner(owner);
        await (commitLegacy || commit)(prepared.records, owner); assertOwner(owner);
        applyLegacy(prepared.records); legacy = structuredClone(prepared.report);
      }
      let passportImported = false;
      if (hasPassport) {
        try {
          if (passportError) throw passportError;
          if (snapshotError) throw snapshotError;
          assertSnapshot(owner, snapshot);
          await passport.mutate(current => addPassportVisits(current, addition), snapshot);
          assertOwner(owner); passportImported = true;
        } catch (error) {
          assertOwner(owner); if (error.code === 'ACCOUNT_CHANGED' || !legacy) throw error;
          passportError = error;
        }
      }
      return { legacy, passportImported, partial: Boolean(passportError), ...(passportError ? { passportError: passportError.code || 'TRANSFER_FAILED' } : {}) };
    }
  };
}
