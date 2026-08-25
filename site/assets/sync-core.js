const DOCUMENTS = Object.freeze([
  {
    localKey: 'favorites', documentKey: 'favorites', merge: mergeFavorites,
    mergeConcurrent: mergeFavoritesThreeWay
  },
  {
    localKey: 'recents', documentKey: 'recents', merge: mergeRecents,
    mergeConcurrent: mergeRecentsThreeWay
  },
  {
    localKey: 'prefs',
    documentKey: 'preferences',
    merge: mergePreferences,
    mergeConcurrent: mergePreferencesThreeWay,
    mergeInitial: (_local, remote) => remote
  }
]);

export function stableStringify(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function newer(left, right, property) {
  const leftTime = Date.parse(left?.[property] || '') || 0;
  const rightTime = Date.parse(right?.[property] || '') || 0;
  if (rightTime !== leftTime) return rightTime > leftTime ? right : left;
  return stableStringify(right) > stableStringify(left) ? right : left;
}

function has(object, key) {
  return object != null && Object.prototype.hasOwnProperty.call(object, key);
}

function mergeMapThreeWay(base = {}, local = {}, remote = {}, timestampProperty) {
  const merged = {};
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})]);
  for (const key of [...keys].sort()) {
    const baseHas = has(base, key);
    const localHas = has(local, key);
    const remoteHas = has(remote, key);
    const baseValue = baseHas ? base[key] : undefined;
    const localValue = localHas ? local[key] : undefined;
    const remoteValue = remoteHas ? remote[key] : undefined;
    const localChanged = localHas !== baseHas || stableStringify(localValue) !== stableStringify(baseValue);
    const remoteChanged = remoteHas !== baseHas || stableStringify(remoteValue) !== stableStringify(baseValue);

    if (localChanged && remoteChanged) {
      if (localHas && remoteHas) merged[key] = newer(localValue, remoteValue, timestampProperty);
      continue; // An explicit deletion wins over a concurrent update.
    }
    if (localChanged) {
      if (localHas) merged[key] = localValue;
      continue;
    }
    if (remoteChanged) {
      if (remoteHas) merged[key] = remoteValue;
      continue;
    }
    if (baseHas) merged[key] = baseValue;
  }
  return merged;
}

export function mergeFavorites(local = {}, remote = {}) {
  const merged = { ...(remote && typeof remote === 'object' ? remote : {}) };
  for (const [id, entry] of Object.entries(local && typeof local === 'object' ? local : {})) {
    merged[id] = id in merged ? newer(merged[id], entry, 'addedAt') : entry;
  }
  return merged;
}

export function mergeFavoritesThreeWay(base = {}, local = {}, remote = {}) {
  return mergeMapThreeWay(base, local, remote, 'addedAt');
}

export function mergeRecents(local = [], remote = []) {
  const byId = new Map();
  for (const entry of [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])]) {
    const id = entry?.stationuuid || entry?.uuid;
    if (!id) continue;
    byId.set(id, byId.has(id) ? newer(byId.get(id), entry, 'playedAt') : entry);
  }
  return [...byId.values()]
    .sort((left, right) => (Date.parse(right?.playedAt || '') || 0) - (Date.parse(left?.playedAt || '') || 0))
    .slice(0, 50);
}

function recentsById(entries) {
  return Object.fromEntries((Array.isArray(entries) ? entries : [])
    .filter(entry => entry?.stationuuid || entry?.uuid)
    .map(entry => [entry.stationuuid || entry.uuid, entry]));
}

export function mergeRecentsThreeWay(base = [], local = [], remote = []) {
  const merged = mergeMapThreeWay(recentsById(base), recentsById(local), recentsById(remote), 'playedAt');
  return Object.values(merged)
    .sort((left, right) => (Date.parse(right?.playedAt || '') || 0) - (Date.parse(left?.playedAt || '') || 0))
    .slice(0, 50);
}

export function mergePreferences(local = {}, remote = {}) {
  return {
    ...(remote && typeof remote === 'object' ? remote : {}),
    ...(local && typeof local === 'object' ? local : {})
  };
}

export function mergePreferencesThreeWay(base = {}, local = {}, remote = {}) {
  const merged = {};
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})]);
  for (const key of [...keys].sort()) {
    const baseHas = has(base, key);
    const localHas = has(local, key);
    const remoteHas = has(remote, key);
    const baseValue = baseHas ? base[key] : undefined;
    const localChanged = localHas !== baseHas || stableStringify(local[key]) !== stableStringify(baseValue);
    const remoteChanged = remoteHas !== baseHas || stableStringify(remote[key]) !== stableStringify(baseValue);
    if (localChanged) {
      if (localHas) merged[key] = local[key];
    } else if (remoteChanged) {
      if (remoteHas) merged[key] = remote[key];
    } else if (baseHas) merged[key] = baseValue;
  }
  return merged;
}

export function shouldResetLocalAccount(previousUserId, nextUserId) {
  return Boolean(previousUserId && nextUserId && previousUserId !== nextUserId);
}

export function accountDataKey(userId, localKey) {
  if (!userId || !DOCUMENTS.some(document => document.localKey === localKey)) {
    throw new Error('A user and synchronized local key are required.');
  }
  return `account:${encodeURIComponent(String(userId))}:${localKey}`;
}

export function planLocalAccountTransition({
  previousUserId,
  nextUserId,
  current,
  saved,
  nextNamespaceExists,
  defaults
}) {
  const previous = previousUserId || null;
  const next = nextUserId || null;
  const writes = [];
  if (previous === next) return { writes, archived: false, restored: false, detached: false, unchanged: true };

  if (previous) {
    for (const { localKey } of DOCUMENTS) {
      writes.push([accountDataKey(previous, localKey), structuredClone(current[localKey] ?? defaults[localKey])]);
    }
  }

  if (!next) {
    for (const { localKey } of DOCUMENTS) {
      writes.push([localKey, structuredClone(defaults[localKey])]);
    }
    return { writes, archived: Boolean(previous), restored: false, detached: Boolean(previous), unchanged: false };
  }

  if (!nextNamespaceExists && !previous) {
    return { writes, archived: false, restored: false, detached: false, unchanged: false };
  }
  for (const { localKey } of DOCUMENTS) {
    writes.push([localKey, structuredClone(saved[localKey] ?? defaults[localKey])]);
  }
  return { writes, archived: Boolean(previous), restored: Boolean(nextNamespaceExists), detached: false, unchanged: false };
}

function normalizeWriteResult(result) {
  if (Array.isArray(result)) return result[0] || null;
  return result || null;
}

export function createSyncEngine({
  readLocal,
  writeLocal,
  readState,
  writeState,
  fetchRemote,
  upsertRemote
}) {
  for (const dependency of [readLocal, writeLocal, readState, writeState, fetchRemote, upsertRemote]) {
    if (typeof dependency !== 'function') throw new Error('Sync engine dependencies must be functions.');
  }

  async function remember(localKey, revision, value) {
    await writeState(localKey, { revision, hash: stableStringify(value), value });
  }

  async function push(document, value, expectedRevision) {
    const row = normalizeWriteResult(await upsertRemote({
      documentKey: document.documentKey,
      value,
      expectedRevision,
      deleteDocument: value === undefined
    }));
    if (!row) return null;
    await remember(document.localKey, Number(row.revision), value);
    return row;
  }

  return {
    async syncOnce() {
      const rows = await fetchRemote();
      const remoteByKey = new Map((Array.isArray(rows) ? rows : []).map(row => [row.document_key, row]));
      const result = { uploaded: 0, downloaded: 0, conflicts: 0 };

      for (const document of DOCUMENTS) {
        const local = await readLocal(document.localKey);
        const localHash = stableStringify(local);
        const state = await readState(document.localKey);
        const remote = remoteByKey.get(document.documentKey);
        const remoteValue = remote?.deleted_at ? undefined : remote?.value;

        if (!remote) {
          if (local !== undefined) {
            const written = await push(document, local, 0);
            if (written) result.uploaded += 1;
            else result.conflicts += 1;
          }
          continue;
        }

        const remoteRevision = Number(remote.revision);
        const remoteHash = stableStringify(remoteValue);

        if (!state) {
          if (local === undefined) {
            await writeLocal(document.localKey, remoteValue);
            await remember(document.localKey, remoteRevision, remoteValue);
            result.downloaded += 1;
            continue;
          }
          const merged = (document.mergeInitial || document.merge)(local, remoteValue);
          const mergedHash = stableStringify(merged);
          if (mergedHash !== localHash) {
            await writeLocal(document.localKey, merged);
            result.downloaded += 1;
          }
          if (mergedHash !== remoteHash) {
            const written = await push(document, merged, remoteRevision);
            if (written) result.uploaded += 1;
            else result.conflicts += 1;
          } else {
            await remember(document.localKey, remoteRevision, merged);
          }
          continue;
        }

        const localChanged = localHash !== state.hash;
        const remoteChanged = remoteRevision !== Number(state.revision) || remoteHash !== state.hash;

        if (localChanged && remoteChanged) {
          const hasBase = Object.prototype.hasOwnProperty.call(state, 'value');
          const merged = hasBase && document.mergeConcurrent
            ? document.mergeConcurrent(state.value, local, remoteValue)
            : document.merge(local, remoteValue);
          await writeLocal(document.localKey, merged);
          const written = await push(document, merged, remoteRevision);
          result.conflicts += 1;
          if (written) result.uploaded += 1;
          continue;
        }

        if (localChanged) {
          const written = await push(document, local, remoteRevision);
          if (written) result.uploaded += 1;
          else result.conflicts += 1;
          continue;
        }

        if (remoteChanged) {
          await writeLocal(document.localKey, remoteValue);
          await remember(document.localKey, remoteRevision, remoteValue);
          result.downloaded += 1;
        }
      }

      return result;
    }
  };
}

export const syncDocuments = DOCUMENTS.map(({ localKey, documentKey }) => ({ localKey, documentKey }));
