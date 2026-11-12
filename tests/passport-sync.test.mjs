import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyncEngine, stableStringify, syncDocuments } from '../site/assets/sync-core.js';
import { emptyPassport, recordPassportPlace, passportEntries } from '../site/assets/passport-core.js';
import { emptySongLibrary, clearSongHistory } from '../site/assets/song-library-core.js';

function setup() {
  const server = new Map(), writes = [];
  const createClient = () => {
    const local = {}, baseline = {}, applied = [], reads = [], hooks = { beforeWrite: null };
    const engine = createSyncEngine({
      readLocal: async key => { reads.push(key); return structuredClone(local[key]); },
      writeLocal: async (key, value) => { local[key] = structuredClone(value); },
      writeLocalIfUnchanged: async (key, expected, value) => {
        if (stableStringify(local[key]) !== stableStringify(expected)) return false;
        local[key] = structuredClone(value); return true;
      },
      readState: async key => structuredClone(baseline[key]),
      writeState: async (key, value) => { baseline[key] = structuredClone(value); },
      fetchRemote: async () => structuredClone([...server.values()]),
      upsertRemote: async ({ documentKey, value, expectedRevision, deleteDocument }) => {
        writes.push({ documentKey, expectedRevision, deleteDocument });
        if (hooks.beforeWrite) { const run = hooks.beforeWrite; hooks.beforeWrite = null; run(); }
        if ((server.get(documentKey)?.revision || 0) !== expectedRevision) return null;
        const row = { document_key: documentKey, revision: expectedRevision + 1,
          value: structuredClone(value), deleted_at: deleteDocument ? '2026-11-12T00:00:00Z' : null };
        server.set(documentKey, row); return structuredClone(row);
      }, onRemoteApplied: key => applied.push(key)
    });
    return { local, baseline, applied, reads, hooks, sync: () => engine.syncOnce() };
  };
  return { server, writes, createClient };
}
const visit = (doc, countrycode, day = 20_000) => recordPassportPlace(doc, { countrycode, confidence: 'country' }, day);

test('Passport is the fifth document after song privacy policy; the four existing contracts retain their order', () => {
  assert.deepEqual(syncDocuments, [
    { localKey: 'favorites', documentKey: 'favorites' }, { localKey: 'recents', documentKey: 'recents' },
    { localKey: 'prefs', documentKey: 'preferences' }, { localKey: 'songs', documentKey: 'songs' },
    { localKey: 'passport', documentKey: 'passport' }
  ]);
});

test('two clients converge positive Passport visits and notify only Passport for a Passport-only update', async () => {
  const { createClient, writes } = setup(), a = createClient(), b = createClient();
  a.local.passport = visit(emptyPassport(), 'US');
  assert.equal((await a.sync()).uploaded, 1);
  assert.equal((await b.sync()).downloaded, 1);
  assert.deepEqual(b.applied, ['passport']);
  a.local.passport = visit(a.local.passport, 'KR');
  b.local.passport = visit(b.local.passport, 'FR');
  await a.sync(); await b.sync(); await a.sync();
  assert.deepEqual(a.local.passport, b.local.passport);
  assert.deepEqual(Object.keys(a.local.passport.countries), ['FR', 'KR', 'US']);
  assert.ok(writes.every(row => row.documentKey === 'passport'));
  assert.deepEqual(a.reads.slice(0, 5), ['favorites', 'recents', 'prefs', 'songs', 'passport']);
});

test('a clear wins over stale offline observations without applying an old wall-clock timestamp', async () => {
  const { createClient, server } = setup(), a = createClient(), b = createClient();
  a.local.songs = emptySongLibrary(); a.local.passport = visit(emptyPassport(), 'US');
  await a.sync(); await b.sync();
  a.local.songs = clearSongHistory(a.local.songs, 100);
  a.local.passport = visit(emptyPassport(1, 100), 'KR');
  b.local.passport = visit(b.local.passport, 'FR', 99_999_999);
  await a.sync(); await b.sync(); await a.sync();
  assert.deepEqual(a.local.passport, b.local.passport);
  assert.equal(a.local.passport.historyEpoch, 1);
  assert.deepEqual(Object.keys(a.local.passport.countries), ['KR']);
  assert.equal(b.local.songs.historyEpoch, 1);
  assert.equal(server.get('passport').value.historyEpoch, server.get('songs').value.historyEpoch);
});

test('remote whole-document Passport tombstone wins over a concurrent stale positive addition', async () => {
  const { createClient, server } = setup(), a = createClient(), b = createClient();
  a.local.passport = visit(emptyPassport(), 'US'); await a.sync(); await b.sync();
  a.local.passport = undefined; await a.sync();
  assert.ok(server.get('passport').deleted_at);
  b.local.passport = visit(b.local.passport, 'KR'); await b.sync();
  assert.equal(b.local.passport, undefined);
  assert.ok(server.get('passport').deleted_at);
  const fresh = createClient(); await fresh.sync();
  assert.equal(fresh.local.passport, undefined);
});

test('an account with no baseline respects an existing remote tombstone instead of silently adopting guest-like local visits', async () => {
  const { createClient, server } = setup();
  server.set('passport', { document_key: 'passport', revision: 5, value: null, deleted_at: '2026-11-12T00:00:00Z' });
  const c = createClient(); c.local.passport = visit(emptyPassport(), 'US');
  await c.sync(); assert.equal(c.local.passport, undefined);
  assert.equal(c.baseline.passport.revision, 5);
  assert.equal(passportEntries(c.local.passport).length, 0);
});

test('a stale compare cannot overwrite a concurrent Passport change and retries on the next sync', async () => {
  const { createClient, server } = setup(), a = createClient();
  a.local.passport = visit(emptyPassport(), 'US'); await a.sync();
  const prior = server.get('passport');
  server.set('passport', { ...prior, revision: prior.revision + 1, value: visit(prior.value, 'KR') });
  a.local.passport = visit(a.local.passport, 'FR');
  a.hooks.beforeWrite = () => {
    const current = server.get('passport');
    server.set('passport', { ...current, revision: current.revision + 1, value: visit(current.value, 'DE') });
  };
  assert.equal((await a.sync()).conflicts, 1);
  assert.equal(server.get('passport').value.countries.FR, undefined, 'rejected CAS never overwrites the concurrent writer');
  await a.sync();
  assert.deepEqual(Object.keys(a.local.passport.countries), ['DE', 'FR', 'KR', 'US']);
  assert.deepEqual(server.get('passport').value, a.local.passport);
});
