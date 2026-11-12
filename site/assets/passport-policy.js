// Helpers for an already owner-fenced earthRadio/kv transaction. This module
// never selects an account, opens a database or imports either store.
import { emptySongLibrary, decodeSongEnvelope, songNamespaceKey, songSyncStateKey } from './song-library-core.js?v=0.34.1';
import { emptyPassport, encodePassportEnvelope, passportNamespaceKey, passportSyncStateKey } from './passport-core.js?v=0.34.1';

export function passportFailure(code, message) { const error = new Error(message); error.code = code; return error; }
const usableGeneration = value => Number.isSafeInteger(value) && value >= 1;
export const passportEnvelopeTag = raw => raw === undefined ? 'missing' : JSON.stringify(
  ['version', 'namespace', 'generation', 'savedAt', 'policyEpoch', 'checksum', 'payload']
    .map(key => typeof raw?.[key] === 'string' || typeof raw?.[key] === 'number' ? raw[key] : null));
export function nextPassportGeneration(raw, floor = 0) {
  const next = Math.max(usableGeneration(raw?.generation) ? raw.generation : 0, usableGeneration(floor) ? floor : 0) + 1;
  if (!Number.isSafeInteger(next)) throw passportFailure('PASSPORT_FULL', 'The Passport generation limit was reached.');
  return next;
}

export function readPassportHistoryPolicy(store, namespace, done, abort) {
  const key = songNamespaceKey(namespace), keys = [key, key + ':privacy', songSyncStateKey(namespace)], values = [];
  let remaining = keys.length;
  keys.forEach((name, index) => {
    const read = store.get(name);
    read.onerror = () => abort(passportFailure('PASSPORT_STORAGE', 'Listening history could not be read.'));
    read.onsuccess = () => {
      values[index] = read.result; if (--remaining) return;
      try {
        const [raw, floor, songState] = values;
        if (floor !== undefined && !usableGeneration(floor)) throw passportFailure('PASSPORT_POLICY_UNAVAILABLE', 'Listening history needs recovery before Passport can be used.');
        let decoded;
        if (raw !== undefined) {
          if (raw?.namespace === namespace && typeof raw.payload === 'string' && raw.payload.length <= 1_048_576) {
            let version; try { version = JSON.parse(raw.payload)?.version; } catch { /* handled by the integrity decoder */ }
            if (version > 1) throw passportFailure('PASSPORT_UPDATE_REQUIRED', 'Update Earth Radio to read listening history.');
          }
          decoded = decodeSongEnvelope(raw, namespace);
          if (!decoded || decoded.generation < (floor || 0)) throw passportFailure('PASSPORT_POLICY_UNAVAILABLE', 'Listening history needs recovery before Passport can be used.');
        } else if (floor) throw passportFailure('PASSPORT_POLICY_UNAVAILABLE', 'Listening history needs recovery before Passport can be used.');
        const value = decoded?.value || emptySongLibrary();
        done({ historyEpoch: value.historyEpoch, historyClearedAt: value.historyClearedAt,
          historyEnabled: value.historyEnabled, settingsVersion: value.settingsVersion,
          songGeneration: decoded?.generation || 0, songState });
      } catch (error) { abort(error); }
    };
  });
}

export function queuePassportHistoryClear(store, namespace, policy, savedAt, done, abort) {
  const key = passportNamespaceKey(namespace), stateKey = passportSyncStateKey(namespace);
  const primary = store.get(key), privacy = store.get(key + ':privacy'), state = store.get(stateKey);
  state.onsuccess = () => {
    try {
      // A user-requested history clear can replace a damaged Passport without
      // interpreting its payload. Other reads/writes still fail closed on damage.
      const generation = nextPassportGeneration(primary.result, privacy.result);
      const value = emptyPassport(policy.historyEpoch, policy.historyClearedAt);
      const envelope = encodePassportEnvelope(namespace, generation, value, savedAt);
      store.put(envelope, key); store.put(generation, key + ':privacy'); store.delete(key + ':damaged');
      // The baseline is also a private recovery copy. Keep the CAS revision for
      // a previously synced offline account, but force its next sync to merge
      // against the server instead of acknowledging an obsolete payload/hash.
      if (state.result && Number.isSafeInteger(state.result.revision) && state.result.revision >= 0 && typeof state.result.hash === 'string') {
        store.put({ revision: state.result.revision, hash: 'passport-policy-cleared', value }, stateKey);
      } else store.delete(stateKey);
      done(envelope);
    } catch (error) { abort(error); }
  };
  primary.onerror = privacy.onerror = state.onerror = () => abort(passportFailure('PASSPORT_STORAGE', 'Passport history could not be cleared.'));
}

export function mirrorPassportEnvelope(storage, envelope, forgetPrior = false) {
  if (!storage) return false;
  const key = passportNamespaceKey(envelope.namespace);
  try {
    if (forgetPrior) { storage.removeItem(key + ':backup'); storage.removeItem(key + ':previous'); }
    const previous = storage.getItem(key + ':backup');
    storage.setItem(key + ':backup', JSON.stringify(envelope));
    if (forgetPrior) storage.setItem(key + ':previous', JSON.stringify(envelope));
    else if (previous) storage.setItem(key + ':previous', previous);
    return true;
  } catch { return false; }
}
