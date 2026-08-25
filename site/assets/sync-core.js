const DOCUMENTS = Object.freeze([
  { localKey: 'favorites', documentKey: 'favorites', merge: mergeFavorites },
  { localKey: 'recents', documentKey: 'recents', merge: mergeRecents },
  { localKey: 'prefs', documentKey: 'preferences', merge: mergePreferences }
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
  return rightTime >= leftTime ? right : left;
}

export function mergeFavorites(local = {}, remote = {}) {
  const merged = { ...(remote && typeof remote === 'object' ? remote : {}) };
  for (const [id, entry] of Object.entries(local && typeof local === 'object' ? local : {})) {
    merged[id] = id in merged ? newer(merged[id], entry, 'addedAt') : entry;
  }
  return merged;
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

export function mergePreferences(local = {}, remote = {}) {
  return {
    ...(remote && typeof remote === 'object' ? remote : {}),
    ...(local && typeof local === 'object' ? local : {})
  };
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
    await writeState(localKey, { revision, hash: stableStringify(value) });
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
          const merged = document.merge(local, remoteValue);
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
          const merged = document.merge(local, remoteValue);
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
