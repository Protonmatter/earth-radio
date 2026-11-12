import {
  emptyPassport, normalizePassport, encodePassportEnvelope, decodePassportEnvelope,
  passportNamespaceKey, passportSyncStateKey, addPassportVisits
} from './passport-core.js?v=0.37.0';
import { getSongLibraryAccount, subscribeSongLibraryAccount, songLibraryStore } from './song-library-store.js?v=0.37.0';
import {
  passportFailure as failure, passportEnvelopeTag as rawTag, nextPassportGeneration,
  readPassportHistoryPolicy, queuePassportHistoryClear, mirrorPassportEnvelope
} from './passport-policy.js?v=0.37.0';

const namespaceOf = id => id ? `account:${encodeURIComponent(id)}` : 'default';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const corrupt = () => failure('PASSPORT_CORRUPT', 'The saved Passport needs recovery. Try account sync or restore an export.');
const storageError = () => failure('PASSPORT_STORAGE', 'Passport storage could not finish.');
const classify = error => typeof error?.code === 'string' ? error : storageError();
const isGeneration = value => Number.isSafeInteger(value) && value >= 1;
const samePolicy = (a, b) => a.historyEpoch === b.historyEpoch && a.settingsVersion === b.settingsVersion
  && a.historyEnabled === b.historyEnabled && a.historyClearedAt === b.historyClearedAt;

export function createPassportStore({ indexedDBImpl = globalThis.indexedDB,
  storage = () => { try { return globalThis.localStorage; } catch { return null; } },
  getAccount = getSongLibraryAccount, now = Date.now, channel = null, subscribePolicy = null } = {}) {
  const listeners = new Set(); let backupAvailable = true, disposed = false, policyFence = null;
  const storageObject = () => { try { return typeof storage === 'function' ? storage() : storage; } catch { return null; } };
  const changed = (broadcast = true) => {
    if (disposed) return;
    for (const listener of listeners) { try { listener(); } catch { console.warn('Earth Radio Passport view could not refresh.'); } }
    if (broadcast) { try { channel?.postMessage({ changed: true }); } catch { /* local subscribers still received the change */ } }
  };
  if (channel) channel.onmessage = () => changed(false);
  const storageChanged = event => { if (/^earth-radio-(?:passport|songs)-v1:/.test(event.key || '')) changed(false); };
  if (typeof window !== 'undefined') window.addEventListener('storage', storageChanged);
  const unsubscribePolicy = subscribePolicy?.(() => changed(false));
  function token(accountId) {
    if (disposed) throw failure('PASSPORT_DISPOSED', 'Passport storage has closed.');
    const owner = getAccount();
    if (!owner?.ready || !Number.isSafeInteger(owner.version) || owner.version < 0
        || owner.accountId !== null && (typeof owner.accountId !== 'string' || !owner.accountId)) throw failure('PASSPORT_NOT_READY', 'Wait for the account to finish loading.');
    if (accountId !== undefined && owner.accountId !== accountId) throw failure('ACCOUNT_CHANGED', 'Account changed while using Passport.');
    return { ...owner, namespace: namespaceOf(owner.accountId) };
  }
  function assertToken(expected) {
    const current = getAccount();
    if (disposed) throw failure('PASSPORT_DISPOSED', 'Passport storage has closed.');
    if (!current?.ready || current.version !== expected.version || current.accountId !== expected.accountId) throw failure('ACCOUNT_CHANGED', 'Account changed while using Passport.');
  }
  function assertFence(expected, policy, fence, requireEnabled = true) {
    if (!fence || expected.version !== fence.ownerVersion) throw failure('ACCOUNT_CHANGED', 'Account changed while saving Passport.');
    if (requireEnabled && !policy.historyEnabled) throw failure('PASSPORT_HISTORY_OFF', 'Turn on listening history to add to Passport.');
    if (policy.historyEpoch !== fence.historyEpoch || policy.settingsVersion !== fence.settingsVersion) throw failure('PASSPORT_POLICY_CHANGED', 'Listening history changed while saving Passport.');
  }
  function open() {
    return new Promise((resolve, reject) => {
      if (!indexedDBImpl) { reject(storageError()); return; }
      let request, failed = false;
      const stop = () => { failed = true; clearTimeout(timer); reject(storageError()); };
      const timer = setTimeout(stop, 8000);
      try {
        request = indexedDBImpl.open('earthRadio', 1);
        request.onupgradeneeded = () => {
          for (const name of ['kv', 'cache']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        };
        request.onsuccess = () => { clearTimeout(timer); if (failed) request.result.close(); else resolve(request.result); };
        request.onerror = request.onblocked = stop;
      } catch { stop(); }
    });
  }
  async function transact(expected, mode, work) {
    assertToken(expected); const db = await open();
    try {
      assertToken(expected);
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode), store = tx.objectStore('kv'); let result, error, settled = false, observedPolicy;
        const timer = setTimeout(() => abort(storageError()), 8000);
        const abort = reason => { error = classify(reason); try { tx.abort(); } catch { clearTimeout(timer); if (!settled) reject(error); } };
        tx.oncomplete = () => {
          settled = true; clearTimeout(timer);
          try {
            assertToken(expected);
            if (observedPolicy) policyFence = Object.freeze({ namespace: expected.namespace, ownerVersion: expected.version,
              historyEpoch: observedPolicy.historyEpoch, settingsVersion: observedPolicy.settingsVersion,
              historyEnabled: observedPolicy.historyEnabled, historyClearedAt: observedPolicy.historyClearedAt });
            resolve(result);
          } catch (reason) { reject(reason); }
        };
        tx.onerror = tx.onabort = () => { settled = true; clearTimeout(timer); reject(error || storageError()); };
        const active = store.get('account:active'); active.onerror = () => abort(storageError());
        active.onsuccess = () => {
          try {
            assertToken(expected);
            if (namespaceOf(active.result || null) !== expected.namespace) throw failure('ACCOUNT_CHANGED', 'Account changed while using Passport.');
            readPassportHistoryPolicy(store, expected.namespace, policy => {
              try { assertToken(expected); observedPolicy = policy; work(store, policy, value => { result = value; }, abort); } catch (reason) { abort(reason); }
            }, abort);
          } catch (reason) { abort(reason); }
        };
      });
    } catch (error) { throw classify(error); } finally { db.close(); }
  }
  function decode(raw, namespace) {
    const decoded = decodePassportEnvelope(raw, namespace);
    if (raw !== undefined && !decoded) throw corrupt();
    return decoded;
  }
  async function rawSnapshot(expected) {
    return transact(expected, 'readonly', (store, policy, done, abort) => {
      const key = passportNamespaceKey(expected.namespace), keys = [key, passportSyncStateKey(expected.namespace), key + ':privacy'], values = [];
      let remaining = keys.length;
      keys.forEach((name, index) => { const read = store.get(name); read.onerror = () => abort(storageError());
        read.onsuccess = () => { values[index] = read.result; if (--remaining) return;
          if (values[2] !== undefined && !isGeneration(values[2])) { abort(corrupt()); return; }
          done({ raw: values[0], state: values[1], privacyFloor: values[2] || 0, policy });
        };
      });
    });
  }
  function backups(namespace, policy, floor) {
    const target = storageObject(), key = passportNamespaceKey(namespace), candidates = []; let obsolete = false;
    for (const suffix of [':backup', ':previous']) {
      let raw;
      try {
        const text = target?.getItem(key + suffix); if (!text || text.length > 1_048_576) continue;
        raw = JSON.parse(text);
        if (raw?.namespace === namespace && Number.isSafeInteger(raw.policyEpoch) && raw.policyEpoch >= 0
            && raw.policyEpoch < policy.historyEpoch && raw.payload !== 'null') { obsolete = true; continue; }
        const decoded = decodePassportEnvelope(raw, namespace);
        if (!decoded || decoded.generation < floor) continue;
        if (decoded.value && decoded.policyEpoch > policy.historyEpoch) throw failure('PASSPORT_POLICY_PENDING', 'Wait for listening-history sync before using Passport.');
        if (!decoded.value || decoded.policyEpoch === policy.historyEpoch) candidates.push({ raw, decoded });
      } catch (error) { if (['PASSPORT_UPDATE_REQUIRED', 'PASSPORT_POLICY_PENDING'].includes(error.code)) throw error; }
    }
    candidates.sort((a, b) => b.decoded.generation - a.decoded.generation || b.decoded.savedAt - a.decoded.savedAt);
    return { copy: candidates[0], obsolete };
  }
  function currentMirror(raw, namespace) {
    if (!raw) return true;
    try { const text = storageObject()?.getItem(passportNamespaceKey(namespace) + ':backup'); return Boolean(text && text.length <= 1_048_576 && rawTag(JSON.parse(text)) === rawTag(raw)); }
    catch { return false; }
  }
  async function publishBackup(expected, envelope, forgetPrior = false, expectedPolicy = null) {
    return transact(expected, 'readwrite', (store, policy, done) => {
      const read = store.get(passportNamespaceKey(expected.namespace));
      read.onsuccess = () => {
        const matched = rawTag(read.result) === rawTag(envelope) && (!expectedPolicy || samePolicy(policy, expectedPolicy))
          && (envelope.payload === 'null' || envelope.policyEpoch === policy.historyEpoch);
        if (matched) {
          backupAvailable = mirrorPassportEnvelope(storageObject(), envelope, forgetPrior);
        }
        // Mirror quota is independent of the authoritative primary/policy fence.
        done(matched);
      };
    });
  }
  function staleBaseline(state, policy) {
    let value = state?.value;
    if (value === undefined && typeof state?.hash === 'string') {
      try { value = JSON.parse(state.hash); } catch { /* dirty sentinels have no payload */ }
    }
    return Number.isSafeInteger(value?.historyEpoch) && value.historyEpoch >= 0 && value.historyEpoch < policy.historyEpoch;
  }
  async function reconcileBaseline(expected, snapshot) {
    await transact(expected, 'readwrite', (store, policy, done) => {
      const key = passportSyncStateKey(expected.namespace), read = store.get(key);
      read.onsuccess = () => {
        if (equal(read.result, snapshot.state) && samePolicy(policy, snapshot.policy) && staleBaseline(read.result, policy)) {
          if (syncReady(read.result)) store.put({ revision: read.result.revision, hash: 'passport-policy-cleared',
            value: emptyPassport(policy.historyEpoch, policy.historyClearedAt) }, key);
          else store.delete(key);
        }
        done(true);
      };
    });
  }
  async function reconcileClear(expected, snapshot) {
    const result = await transact(expected, 'readwrite', (store, policy, done, abort) => {
      const read = store.get(passportNamespaceKey(expected.namespace)); read.onsuccess = () => {
        if (rawTag(read.result) !== rawTag(snapshot.raw)) { done(null); return; }
        if (policy.historyEpoch < snapshot.policy.historyEpoch) { abort(failure('PASSPORT_POLICY_PENDING', 'Wait for listening-history sync before using Passport.')); return; }
        queuePassportHistoryClear(store, expected.namespace, policy, now(), done, abort);
      };
    });
    if (result) { await publishBackup(expected, result, true); changed(); }
  }
  async function load(expected) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await rawSnapshot(expected); let decoded;
      // Baselines are private recovery copies even when the primary is a valid
      // deletion tombstone. Reconcile independently without reviving that primary.
      if (staleBaseline(current.state, current.policy)) { await reconcileBaseline(expected, current); continue; }
      // A known older policy epoch is an explicit history clear, including when
      // an older client did not know it must clear this separate document.
      if (current.raw?.namespace === expected.namespace && Number.isSafeInteger(current.raw.policyEpoch)
          && current.raw.policyEpoch >= 0 && current.raw.policyEpoch < current.policy.historyEpoch && current.raw.payload !== 'null') {
        await reconcileClear(expected, current); continue;
      }
      try { decoded = decode(current.raw, expected.namespace); } catch (error) { if (error.code !== 'PASSPORT_CORRUPT') throw error; }
      if (decoded && decoded.generation < current.privacyFloor) decoded = undefined;
      if (decoded?.value && decoded.policyEpoch > current.policy.historyEpoch) throw failure('PASSPORT_POLICY_PENDING', 'Wait for listening-history sync before using Passport.');
      const { copy, obsolete } = backups(expected.namespace, current.policy, current.privacyFloor);
      if (decoded) {
        if (obsolete && !await publishBackup(expected, current.raw, true, current.policy)) continue;
        backupAvailable = currentMirror(current.raw, expected.namespace);
        return { ...current, decoded };
      }
      if (obsolete && current.policy.historyEpoch > 0) { await reconcileClear(expected, current); continue; }
      if (copy) {
        const rawGeneration = isGeneration(current.raw?.generation) ? current.raw.generation : 0;
        const restored = encodePassportEnvelope(expected.namespace, nextPassportGeneration({ generation: Math.max(copy.decoded.generation, rawGeneration) }, current.privacyFloor), copy.decoded.value, now());
        const applied = await transact(expected, 'readwrite', (store, policy, done, abort) => {
          const key = passportNamespaceKey(expected.namespace), read = store.get(key); read.onsuccess = () => {
            if (rawTag(read.result) !== rawTag(current.raw)) { done(false); return; }
            if (restored.payload !== 'null' && restored.policyEpoch !== policy.historyEpoch) { abort(failure('PASSPORT_POLICY_CHANGED', 'Listening history changed during Passport recovery.')); return; }
            if (read.result !== undefined) store.put(read.result, key + ':damaged');
            store.put(restored, key); store.delete(passportSyncStateKey(expected.namespace)); done(true);
          };
        });
        if (applied) { await publishBackup(expected, restored); changed(); }
        continue;
      }
      if (current.raw !== undefined || current.privacyFloor) throw corrupt();
      if (current.state?.value !== undefined) {
        await transact(expected, 'readwrite', (store, _policy, done) => {
          const primary = store.get(passportNamespaceKey(expected.namespace)), state = store.get(passportSyncStateKey(expected.namespace));
          state.onsuccess = () => {
            if (primary.result === undefined && equal(state.result, current.state)) store.delete(passportSyncStateKey(expected.namespace));
            done(true);
          };
        });
        continue;
      }
      backupAvailable = true; return { ...current, decoded: undefined };
    }
    throw failure('PASSPORT_CHANGED', 'Passport changed during recovery. Try again.');
  }
  const syncReady = state => Boolean(state && Number.isSafeInteger(state.revision) && state.revision >= 0 && typeof state.hash === 'string');
  function policyValue(decoded, policy) {
    const value = decoded?.value;
    if (value && value.historyEpoch > policy.historyEpoch) throw failure('PASSPORT_POLICY_PENDING', 'Wait for listening-history sync before using Passport.');
    return value && value.historyEpoch < policy.historyEpoch ? emptyPassport(policy.historyEpoch, policy.historyClearedAt) : value;
  }
  const removed = (before, after) => Boolean(before && (!after || after.historyEpoch > before.historyEpoch
    || Object.keys(before.countries).some(key => !after.countries[key]) || Object.keys(before.cities).some(key => !after.cities[key])));
  function readGuestValue(store, done, abort) {
    readPassportHistoryPolicy(store, 'default', policy => {
      const key = passportNamespaceKey('default'), primary = store.get(key), privacy = store.get(key + ':privacy');
      privacy.onsuccess = () => {
        try {
          if (!policy.historyEnabled) { done(undefined); return; }
          if (privacy.result !== undefined && !isGeneration(privacy.result)) throw corrupt();
          const source = decode(primary.result, 'default');
          if (!source?.value || source.generation < (privacy.result || 0) || source.policyEpoch < policy.historyEpoch) { done(undefined); return; }
          if (source.policyEpoch > policy.historyEpoch) throw failure('PASSPORT_POLICY_PENDING', 'Wait for listening-history sync before using Passport.');
          done(source.value);
        } catch (error) { abort(error); }
      };
      primary.onerror = privacy.onerror = () => abort(storageError());
    }, abort);
  }
  async function replace(expected, transform, { compare, fence, guest = false } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const loaded = await load(expected);
      const result = await transact(expected, 'readwrite', (store, policy, done, abort) => {
        const key = passportNamespaceKey(expected.namespace), read = store.get(key), privacy = store.get(key + ':privacy'), state = store.get(passportSyncStateKey(expected.namespace));
        const apply = source => {
          try {
            if (fence) assertFence(expected, policy, fence);
            if (fence && expected.accountId && (!syncReady(state.result) || !syncReady(policy.songState))) throw failure('PASSPORT_SYNC_PENDING', 'Wait for account sync before adding to Passport.');
            if (guest && source === undefined) { done({ matched: true, changed: false }); return; }
            if (rawTag(read.result) !== rawTag(loaded.raw)) { done({ retry: true }); return; }
            if (privacy.result !== undefined && !isGeneration(privacy.result)) throw corrupt();
            const decoded = decode(read.result, expected.namespace), before = policyValue(decoded, policy);
            if (compare && !equal(before, compare.expected)) { done({ matched: false }); return; }
            const transformed = transform(before ?? emptyPassport(policy.historyEpoch, policy.historyClearedAt), source);
            let value = transformed === undefined ? undefined : normalizePassport(transformed);
            if (value && value.historyEpoch > policy.historyEpoch) throw failure('PASSPORT_POLICY_PENDING', 'Wait for listening-history sync before using Passport.');
            if (value && value.historyEpoch < policy.historyEpoch) value = emptyPassport(policy.historyEpoch, policy.historyClearedAt);
            if (fence && transformed === undefined) throw failure('PASSPORT_INVALID', 'Use Clear history to remove Passport entries.');
            if (equal(before, value)) { done({ matched: true, value, changed: false }); return; }
            const envelope = encodePassportEnvelope(expected.namespace, nextPassportGeneration(read.result, privacy.result), value, now());
            const forgetPrior = removed(decoded?.value, value);
            store.put(envelope, key);
            if (forgetPrior) { store.put(envelope.generation, key + ':privacy'); store.delete(key + ':damaged'); }
            done({ matched: true, value, changed: true, envelope, forgetPrior });
          } catch (error) { abort(error); }
        };
        state.onsuccess = () => guest ? readGuestValue(store, apply, abort) : apply(undefined);
        read.onerror = privacy.onerror = state.onerror = () => abort(storageError());
      });
      if (result.retry) continue;
      if (result.changed) { await publishBackup(expected, result.envelope, result.forgetPrior); changed(); }
      return result;
    }
    throw failure('PASSPORT_CHANGED', 'Passport changed while saving. Try again.');
  }
  const api = {
    // No asynchronous work here: native file pickers need the original trusted
    // click activation on Safari. The ticket is checked against IDB on import.
    captureFence() {
      const owner = token();
      if (!policyFence || policyFence.namespace !== owner.namespace || policyFence.ownerVersion !== owner.version) throw failure('PASSPORT_NOT_READY', 'Wait for listening history to finish loading.');
      return { ...policyFence };
    },
    async readPolicy() {
      const owner = token();
      return transact(owner, 'readonly', (_store, policy, done) => done({ namespace: owner.namespace, ownerVersion: owner.version,
        historyEpoch: policy.historyEpoch, settingsVersion: policy.settingsVersion, historyEnabled: policy.historyEnabled,
        historyClearedAt: policy.historyClearedAt }));
    },
    subscribe(listener) { if (disposed) throw failure('PASSPORT_DISPOSED', 'Passport storage has closed.'); listeners.add(listener); return () => listeners.delete(listener); },
    async read() {
      const expected = token(), snapshot = await load(expected); assertToken(expected);
      return { namespace: expected.namespace, ownerVersion: expected.version, generation: snapshot.decoded?.generation || 0,
        historyEpoch: snapshot.policy.historyEpoch, settingsVersion: snapshot.policy.settingsVersion,
        historyClearedAt: snapshot.policy.historyClearedAt,
        historyEnabled: snapshot.policy.historyEnabled,
        value: snapshot.policy.historyEnabled ? snapshot.decoded?.value : emptyPassport(snapshot.policy.historyEpoch, snapshot.policy.historyClearedAt),
        canWrite: snapshot.policy.historyEnabled && (!expected.accountId || syncReady(snapshot.state) && syncReady(snapshot.policy.songState)), backupAvailable };
    },
    async mutate(transform, fence) {
      const expected = token();
      if (!fence || expected.version !== fence.ownerVersion) throw failure('ACCOUNT_CHANGED', 'Account changed while saving Passport.');
      await replace(expected, transform, { fence });
      // Privacy/owner changes after commit but before mirror publication must
      // not return an obsolete private snapshot to a later UI continuation.
      const latest = await load(expected); assertToken(expected); assertFence(expected, latest.policy, fence);
      return latest.decoded?.value;
    },
    async readForAccount(accountId) { const expected = token(accountId), snapshot = await load(expected); assertToken(expected); return snapshot.decoded?.value; },
    async writeForAccount(accountId, value) { const owner = token(accountId), result = await replace(owner, () => value); assertToken(owner); return result.value; },
    async compareForAccount(accountId, expected, value) { const owner = token(accountId), result = await replace(owner, () => value, { compare: { expected } }); assertToken(owner); return result.matched; },
    async readSyncState(accountId) { const expected = token(accountId), snapshot = await load(expected); assertToken(expected); return syncReady(snapshot.state) ? snapshot.state : undefined; },
    async writeSyncState(accountId, value) {
      if (!syncReady(value) || value.hash.length > 262_144) throw corrupt();
      const expected = token(accountId);
      await transact(expected, 'readwrite', (store, policy, done, abort) => {
        try {
          let doc = value.value === undefined ? undefined : normalizePassport(value.value), hash = value.hash;
          if (doc && doc.historyEpoch > policy.historyEpoch) throw failure('PASSPORT_POLICY_PENDING', 'Wait for listening-history sync before using Passport.');
          if (doc && doc.historyEpoch < policy.historyEpoch) { doc = emptyPassport(policy.historyEpoch, policy.historyClearedAt); hash = 'passport-policy-cleared'; }
          store.put({ revision: value.revision, hash, value: doc }, passportSyncStateKey(expected.namespace)); done(true);
        } catch (error) { abort(error); }
      }); assertToken(expected); changed();
    },
    async ensureSyncBaseline(accountId) {
      const expected = token(accountId);
      const written = await transact(expected, 'readwrite', (store, _policy, done) => {
        const key = passportSyncStateKey(expected.namespace), read = store.get(key); read.onsuccess = () => {
          if (read.result !== undefined) { done(false); return; }
          store.put({ revision: 0, hash: 'undefined', value: undefined }, key); done(true);
        };
      }); assertToken(expected); if (written) changed();
    },
    async guestPassportAvailable() {
      const expected = token(); if (!expected.accountId) return false;
      const available = await transact(expected, 'readonly', (store, policy, done, abort) => {
        readGuestValue(store, source => {
          const own = store.get(passportNamespaceKey(expected.namespace));
          own.onerror = () => abort(storageError());
          own.onsuccess = () => {
          try {
            const destination = policyValue(decode(own.result, expected.namespace), policy) || emptyPassport(policy.historyEpoch, policy.historyClearedAt);
            done(Boolean(policy.historyEnabled && source && !equal(addPassportVisits(destination, source), destination)));
          } catch (error) { abort(error); }
          };
        }, abort);
      });
      assertToken(expected); return available;
    },
    async importGuest(fence) {
      const expected = token(); if (!expected.accountId || expected.version !== fence?.ownerVersion) throw failure('ACCOUNT_CHANGED', 'Account changed while adding this device’s Passport.');
      // Read the guest's own history policy and merge in the destination write
      // transaction; a guest clear/off cannot race a copied pre-clear payload.
      await replace(expected, (current, source) => addPassportVisits(current, source), { fence, guest: true });
      const latest = await load(expected); assertToken(expected); assertFence(expected, latest.policy, fence);
      return latest.decoded?.value;
    },
    dispose() { if (disposed) return; disposed = true; unsubscribePolicy?.(); listeners.clear(); if (channel) { channel.onmessage = null; channel.close(); } if (typeof window !== 'undefined') window.removeEventListener('storage', storageChanged); }
  };
  return api;
}

let singleton;
export function passportStore() {
  if (!singleton) {
    let channel = null;
    try { if (typeof window !== 'undefined' && typeof BroadcastChannel === 'function') channel = new BroadcastChannel('earth-radio-passport-v1'); } catch { /* local notifications still work */ }
    singleton = createPassportStore({ channel, subscribePolicy(listener) {
      const unsubscribeOwner = subscribeSongLibraryAccount(listener), unsubscribeSongs = songLibraryStore().subscribe(listener);
      return () => { unsubscribeOwner(); unsubscribeSongs(); };
    } });
    if (typeof window !== 'undefined') window.addEventListener('pagehide', event => { if (!event.persisted) singleton?.dispose(); });
  }
  return singleton;
}
