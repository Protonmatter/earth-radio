import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthClient } from '../site/assets/auth-core.js';
import { createSyncEngine, mergeFavorites, stableStringify } from '../site/assets/sync-core.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('OAuth sign-in uses PKCE and stores only the verifier locally', async () => {
  const storage = memoryStorage();
  const assigned = [];
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    location: {
      href: 'https://earth-radio.example/',
      origin: 'https://earth-radio.example',
      pathname: '/',
      assign: url => assigned.push(url)
    }
  });

  await client.signInWithOAuth('github');

  assert.equal(assigned.length, 1);
  const url = new URL(assigned[0]);
  assert.equal(url.pathname, '/auth/v1/authorize');
  assert.equal(url.searchParams.get('provider'), 'github');
  assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.ok(storage.getItem('earthRadio.auth.pkce.v1'));
  assert.doesNotMatch(storage.getItem('earthRadio.auth.pkce.v1'), /challenge/i);
});

test('OAuth callback exchanges the code, persists the session, and cleans the URL', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.pkce.v1', 'verifier-value');
  const requests = [];
  const replaced = [];
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    location: {
      href: 'https://earth-radio.example/?code=oauth-code&domain=world',
      origin: 'https://earth-radio.example',
      pathname: '/',
      search: '?code=oauth-code&domain=world',
      hash: ''
    },
    history: { replaceState: (_state, _title, url) => replaced.push(url) },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
        user: { id: 'user-1', email: 'person@example.test' }
      });
    }
  });

  const session = await client.initialize();

  assert.equal(session.user.id, 'user-1');
  assert.equal(requests[0].url, 'https://project.supabase.co/auth/v1/token?grant_type=pkce');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    auth_code: 'oauth-code', code_verifier: 'verifier-value'
  });
  assert.equal(requests[0].init.headers.apikey, 'sb_publishable_test');
  assert.equal(storage.getItem('earthRadio.auth.pkce.v1'), null);
  assert.ok(storage.getItem('earthRadio.auth.session.v1'));
  assert.equal(replaced[0], '/?domain=world');
});

test('identity linking is authorized with the current access token', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'current-access', refresh_token: 'refresh', expires_at: 9999999999,
    user: { id: 'user-1' }
  }));
  const requests = [];
  const assigned = [];
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    location: {
      href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/',
      assign: url => assigned.push(url)
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ url: 'https://provider.example/link' });
    }
  });

  await client.linkIdentity('github');

  assert.match(requests[0].url, /\/auth\/v1\/user\/identities\/authorize\?/);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer current-access');
  assert.equal(assigned[0], 'https://provider.example/link');
});

test('stableStringify is deterministic and favorite merges preserve the newest item', () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
  const merged = mergeFavorites(
    { station: { uuid: 'station', addedAt: '2026-01-01T00:00:00Z', station: { name: 'Old' } } },
    { station: { uuid: 'station', addedAt: '2026-02-01T00:00:00Z', station: { name: 'New' } } }
  );
  assert.equal(merged.station.station.name, 'New');
});

test('sync uploads first-device data and records the returned revision', async () => {
  const local = { favorites: { station: { uuid: 'station' } }, recents: [], prefs: { theme: 'dark' } };
  const state = {};
  const writes = [];
  const engine = createSyncEngine({
    readLocal: async key => local[key],
    writeLocal: async (key, value) => { local[key] = value; writes.push([key, value]); },
    readState: async key => state[key] ?? null,
    writeState: async (key, value) => { state[key] = value; },
    fetchRemote: async () => [],
    upsertRemote: async ({ documentKey, expectedRevision, value }) => ({
      document_key: documentKey, revision: expectedRevision + 1, value, deleted_at: null
    })
  });

  const result = await engine.syncOnce();

  assert.equal(result.uploaded, 3);
  assert.equal(result.downloaded, 0);
  assert.equal(state.favorites.revision, 1);
  assert.deepEqual(writes, []);
});

test('sync downloads a remote-only change and resolves concurrent favorites by union', async () => {
  const local = { favorites: { local: { uuid: 'local' } }, recents: [], prefs: { theme: 'light' } };
  const state = {
    favorites: { revision: 1, hash: stableStringify({ old: { uuid: 'old' } }) },
    recents: { revision: 1, hash: stableStringify([]) },
    prefs: { revision: 1, hash: stableStringify({ theme: 'light' }) }
  };
  const remote = [
    { document_key: 'favorites', revision: 2, value: { remote: { uuid: 'remote' } }, deleted_at: null },
    { document_key: 'recents', revision: 1, value: [], deleted_at: null },
    { document_key: 'preferences', revision: 1, value: { theme: 'light' }, deleted_at: null }
  ];
  const pushes = [];
  const engine = createSyncEngine({
    readLocal: async key => local[key],
    writeLocal: async (key, value) => { local[key] = value; },
    readState: async key => state[key] ?? null,
    writeState: async (key, value) => { state[key] = value; },
    fetchRemote: async () => remote,
    upsertRemote: async input => {
      pushes.push(input);
      return { document_key: input.documentKey, revision: input.expectedRevision + 1, value: input.value, deleted_at: null };
    }
  });

  const result = await engine.syncOnce();

  assert.equal(result.conflicts, 1);
  assert.deepEqual(Object.keys(local.favorites).sort(), ['local', 'remote']);
  assert.equal(pushes[0].expectedRevision, 2);
  assert.deepEqual(Object.keys(pushes[0].value).sort(), ['local', 'remote']);
});
