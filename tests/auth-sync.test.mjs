import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createAuthClient } from '../site/assets/auth-core.js';
import {
  accountDataKey, createSyncEngine, mergeFavorites, shouldResetLocalAccount,
  stableStringify, transitionLocalAccount
} from '../site/assets/sync-core.js';

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
  const redirect = new URL(url.searchParams.get('redirect_to'));
  const flowId = redirect.searchParams.get('er_auth_flow');
  const flows = JSON.parse(storage.getItem('earthRadio.auth.pkce.v1'));
  assert.ok(flowId);
  assert.ok(flows[flowId].verifier);
  assert.equal(Object.keys(flows).length, 1);
});

test('OAuth callback exchanges the code, persists the session, and cleans the URL', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.pkce.v1', JSON.stringify({
    'flow-1': { verifier: 'verifier-value', createdAt: Date.now() }
  }));
  const requests = [];
  const replaced = [];
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    location: {
      href: 'https://earth-radio.example/?code=oauth-code&er_auth_flow=flow-1&domain=world',
      origin: 'https://earth-radio.example',
      pathname: '/',
      search: '?code=oauth-code&er_auth_flow=flow-1&domain=world',
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

test('parallel OAuth starts retain independent PKCE verifiers', async () => {
  const storage = memoryStorage();
  const assigned = [];
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    location: {
      href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/',
      assign: url => assigned.push(url)
    }
  });

  await client.signInWithOAuth('github');
  await client.signInWithOAuth('google');

  const flows = JSON.parse(storage.getItem('earthRadio.auth.pkce.v1'));
  assert.equal(Object.keys(flows).length, 2);
  const flowIds = assigned.map(value => new URL(new URL(value).searchParams.get('redirect_to')).searchParams.get('er_auth_flow'));
  assert.equal(new Set(flowIds).size, 2);
  assert.ok(flowIds.every(flowId => flows[flowId]?.verifier));
});

test('transient refresh failures retain and restore the offline session', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'expired-access', refresh_token: 'still-valid', expires_at: 1,
    user: { id: 'user-1' }
  }));
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    location: { href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/' },
    fetchImpl: async () => { throw new TypeError('offline'); }
  });

  const session = await client.initialize();
  assert.equal(session.user.id, 'user-1');
  assert.ok(storage.getItem('earthRadio.auth.session.v1'));
});

test('offline sign-out still completes locally so private device data can be cleared', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'access', refresh_token: 'refresh', expires_at: 4102444800,
    user: { id: 'user-1' }
  }));
  const events = [];
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    location: { href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/' },
    fetchImpl: async () => { throw new TypeError('offline'); }
  });
  client.onAuthStateChange((event, session) => events.push([event, session]));

  await client.signOut();

  assert.equal(storage.getItem('earthRadio.auth.session.v1'), null);
  assert.deepEqual(events, [['SIGNED_OUT', null]]);
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

test('first sync keeps established remote preferences over this device defaults', async () => {
  const local = { prefs: { theme: 'system', volume: 0.8 } };
  const state = {};
  const pushes = [];
  const engine = createSyncEngine({
    readLocal: async key => local[key],
    writeLocal: async (key, value) => { local[key] = value; },
    readState: async key => state[key] ?? null,
    writeState: async (key, value) => { state[key] = value; },
    fetchRemote: async () => [{
      document_key: 'preferences', revision: 7,
      value: { theme: 'dark', volume: 0.3 }, deleted_at: null
    }],
    upsertRemote: async input => { pushes.push(input); return null; }
  });

  const result = await engine.syncOnce();

  assert.deepEqual(local.prefs, { theme: 'dark', volume: 0.3 });
  assert.equal(result.downloaded, 1);
  assert.equal(pushes.length, 0);
  assert.equal(state.prefs.revision, 7);
});

test('account boundaries reset local synced data only when switching known users', () => {
  assert.equal(shouldResetLocalAccount(null, 'user-a'), false);
  assert.equal(shouldResetLocalAccount('user-a', 'user-a'), false);
  assert.equal(shouldResetLocalAccount('user-a', 'user-b'), true);
});

test('account transitions archive offline data and restore each user namespace', async () => {
  const values = new Map([
    ['favorites', { a: { uuid: 'a' } }],
    ['recents', [{ uuid: 'a' }]],
    ['prefs', { theme: 'dark' }],
    [accountDataKey('user-b', 'favorites'), { b: { uuid: 'b' } }],
    [accountDataKey('user-b', 'recents'), [{ uuid: 'b' }]],
    [accountDataKey('user-b', 'prefs'), { theme: 'light' }]
  ]);
  const storage = {
    readLocal: async key => values.get(key),
    writeLocal: async (key, value) => values.set(key, value)
  };
  const defaults = { favorites: {}, recents: [], prefs: { theme: 'system' } };

  await transitionLocalAccount({
    previousUserId: 'user-a', nextUserId: 'user-b', ...storage, defaults
  });

  assert.deepEqual(values.get(accountDataKey('user-a', 'favorites')), { a: { uuid: 'a' } });
  assert.deepEqual(values.get('favorites'), { b: { uuid: 'b' } });
  assert.deepEqual(values.get('recents'), [{ uuid: 'b' }]);
  assert.deepEqual(values.get('prefs'), { theme: 'light' });

  await transitionLocalAccount({
    previousUserId: 'user-b', nextUserId: null, ...storage, defaults
  });
  assert.deepEqual(values.get(accountDataKey('user-b', 'favorites')), { b: { uuid: 'b' } });
  assert.deepEqual(values.get('favorites'), {});

  await transitionLocalAccount({
    previousUserId: null, nextUserId: 'user-a', ...storage, defaults
  });
  assert.deepEqual(values.get('favorites'), { a: { uuid: 'a' } });
  assert.deepEqual(values.get('prefs'), { theme: 'dark' });
});

test('cross-tab session replacement emits the new user before the UI can continue syncing', () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'a', refresh_token: 'a', expires_at: 4102444800, user: { id: 'user-a' }
  }));
  let storageListener;
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    eventTarget: { addEventListener: (_name, listener) => { storageListener = listener; } },
    location: { href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/' }
  });
  const events = [];
  client.onAuthStateChange((event, session) => events.push([event, session?.user?.id]));
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'b', refresh_token: 'b', expires_at: 4102444800, user: { id: 'user-b' }
  }));

  storageListener({ key: 'earthRadio.auth.session.v1' });

  assert.deepEqual(events, [['SIGNED_IN', 'user-b']]);
});

test('three-way sync does not resurrect a locally deleted favorite', async () => {
  const base = { station: { uuid: 'station', addedAt: '2026-01-01T00:00:00Z' } };
  const local = { favorites: {}, recents: undefined, prefs: undefined };
  const state = {
    favorites: { revision: 1, hash: stableStringify(base), value: base }
  };
  const pushes = [];
  const engine = createSyncEngine({
    readLocal: async key => local[key],
    writeLocal: async (key, value) => { local[key] = value; },
    readState: async key => state[key] ?? null,
    writeState: async (key, value) => { state[key] = value; },
    fetchRemote: async () => [{
      document_key: 'favorites', revision: 2,
      value: { ...base, other: { uuid: 'other', addedAt: '2026-02-01T00:00:00Z' } },
      deleted_at: null
    }],
    upsertRemote: async input => {
      pushes.push(input);
      return { document_key: input.documentKey, revision: 3, value: input.value, deleted_at: null };
    }
  });

  const result = await engine.syncOnce();

  assert.equal(result.conflicts, 1);
  assert.deepEqual(Object.keys(local.favorites), ['other']);
  assert.deepEqual(Object.keys(pushes[0].value), ['other']);
  assert.deepEqual(state.favorites.value, pushes[0].value);
});

test('production auth excludes Cloudflare preview origins', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const runtimeConfig = await readFile(path.join(root, 'site', 'config.js'), 'utf8');
  const supabaseConfig = await readFile(path.join(root, 'supabase', 'config.toml'), 'utf8');
  assert.match(runtimeConfig, /authOriginAllowed/);
  assert.match(runtimeConfig, /https:\/\/earth-radio\.pages\.dev/);
  assert.doesNotMatch(runtimeConfig, /\*\.earth-radio\.pages\.dev/);
  assert.doesNotMatch(supabaseConfig, /\*\.earth-radio\.pages\.dev/);
});
