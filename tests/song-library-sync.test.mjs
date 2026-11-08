import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyncEngine, stableStringify } from '../site/assets/sync-core.js';
import { emptySongLibrary, setSongLiked, recordHeardSong, clearSongHistory, libraryEntries } from '../site/assets/song-library-core.js';

test('two clients sync songs through CAS and notify only the library, preserving a concurrent clear/unlike', async () => {
  const song = { id: 'a'.repeat(64), artist: 'Fixture artist', title: 'Fixture song', stationUuid: 'fixture' };
  let remote;
  function client() {
    const local = {}, baseline = {}, applied = [];
    const engine = createSyncEngine({
      readLocal: async key => local[key], writeLocal: async (key, value) => { local[key] = structuredClone(value); },
      writeLocalIfUnchanged: async (key, expected, value) => {
        if (stableStringify(local[key]) !== stableStringify(expected)) return false;
        local[key] = structuredClone(value); return true;
      },
      readState: async key => baseline[key], writeState: async (key, value) => { baseline[key] = structuredClone(value); },
      fetchRemote: async () => remote ? [structuredClone(remote)] : [],
      upsertRemote: async ({ documentKey, expectedRevision, value, deleteDocument }) => {
        assert.equal(documentKey, 'songs');
        if ((remote?.revision || 0) !== expectedRevision) return null;
        remote = { document_key: 'songs', revision: expectedRevision + 1, value: structuredClone(value), deleted_at: deleteDocument ? '2026-11-08T00:00:00Z' : null };
        return structuredClone(remote);
      }, onRemoteApplied: key => applied.push(key)
    });
    return { local, baseline, applied, sync: () => engine.syncOnce() };
  }
  const a = client(), b = client();
  a.local.songs = recordHeardSong(setSongLiked(emptySongLibrary(), song, true, 100), song, 200);
  assert.equal((await a.sync()).uploaded, 1);
  assert.equal((await b.sync()).downloaded, 1);
  assert.deepEqual(b.applied, ['songs']);
  assert.deepEqual(b.local.songs, a.local.songs);
  a.local.songs = clearSongHistory(setSongLiked(a.local.songs, song, false, 300), 400);
  b.local.songs = recordHeardSong(b.local.songs, song, 9999999999);
  await a.sync(); await b.sync(); await a.sync();
  assert.equal(libraryEntries(a.local.songs).length, 0);
  assert.equal(libraryEntries(b.local.songs, 'liked').length, 0);
  assert.deepEqual(a.local.songs, b.local.songs);
  assert.ok([...a.applied, ...b.applied].every(key => key === 'songs'));
  remote = { ...remote, value: null, deleted_at: '2026-11-08T00:00:00Z', revision: remote.revision + 1 };
  a.local.songs = setSongLiked(a.local.songs, song, true, 500);
  await a.sync();
  assert.equal(a.local.songs, undefined);
  assert.equal(remote.value, undefined);
});
