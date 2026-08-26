import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createAuthClient } from '../site/assets/auth-core.js';
import { quiesceSignOut } from '../site/assets/auth-ui.js';
import {
  accountDataKey, accountLocalRecords, createSyncEngine, mergeFavorites, planLocalAccountTransition,
  namespaceForAccount as syncNamespaceForAccount,
  shouldResetBrowserAccount, shouldResetLocalAccount, stableStringify
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

test('OAuth redirects preserve the current query and hash route', async () => {
  const storage = memoryStorage();
  const assigned = [];
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    location: {
      href: 'https://earth-radio.example/?domain=US#station=abc',
      origin: 'https://earth-radio.example', pathname: '/', search: '?domain=US', hash: '#station=abc',
      assign: url => assigned.push(url)
    }
  });

  await client.signInWithOAuth('github');

  const redirect = new URL(new URL(assigned[0]).searchParams.get('redirect_to'));
  assert.equal(redirect.searchParams.get('domain'), 'US');
  assert.ok(redirect.searchParams.get('er_auth_flow'));
  assert.equal(redirect.hash, '#station=abc');
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

test('retryable OAuth callback failures preserve the verifier and callback URL', async () => {
  const storage = memoryStorage();
  const flows = { 'flow-1': { verifier: 'verifier-value', createdAt: Date.now() } };
  storage.setItem('earthRadio.auth.pkce.v1', JSON.stringify(flows));
  const replaced = [];
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    location: {
      href: 'https://earth-radio.example/?code=oauth-code&er_auth_flow=flow-1',
      origin: 'https://earth-radio.example', pathname: '/',
      search: '?code=oauth-code&er_auth_flow=flow-1', hash: ''
    },
    history: { replaceState: (_state, _title, url) => replaced.push(url) },
    fetchImpl: async () => jsonResponse({ error: 'temporarily unavailable' }, 503)
  });

  await assert.rejects(client.initialize(), error => error?.status === 503);

  assert.deepEqual(JSON.parse(storage.getItem('earthRadio.auth.pkce.v1')), flows);
  assert.deepEqual(replaced, []);
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

test('a stale sign-out cannot clear a cross-tab replacement session', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'a', refresh_token: 'a-refresh', expires_at: 4102444800,
    user: { id: 'user-a' }
  }));
  storage.setItem('earthRadio.auth.pkce.v1', JSON.stringify({ pending: { verifier: 'keep-me' } }));
  let storageListener;
  let resolveLogout;
  const logoutResponse = new Promise(resolve => { resolveLogout = resolve; });
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    eventTarget: { addEventListener: (_name, listener) => { storageListener = listener; } },
    location: { href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/' },
    fetchImpl: async () => logoutResponse
  });
  const events = [];
  client.onAuthStateChange((event, session) => events.push([event, session?.user?.id]));

  const pending = client.signOut();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'b', refresh_token: 'b-refresh', expires_at: 4102444800,
    user: { id: 'user-b' }
  }));
  storageListener({ key: 'earthRadio.auth.session.v1' });
  resolveLogout(new Response(null, { status: 204 }));
  assert.equal(await pending, false);

  assert.equal(JSON.parse(storage.getItem('earthRadio.auth.session.v1')).user.id, 'user-b');
  assert.ok(storage.getItem('earthRadio.auth.pkce.v1'));
  assert.deepEqual(events, [['SIGNED_IN', 'user-b']]);
});

test('concurrent sign-out reports success when another tab already cleared the session', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'a', refresh_token: 'a-refresh', expires_at: 4102444800,
    user: { id: 'user-a' }
  }));
  let storageListener;
  let resolveLogout;
  const logoutResponse = new Promise(resolve => { resolveLogout = resolve; });
  const client = createAuthClient({
    url: 'https://project.supabase.co', publishableKey: 'sb_publishable_test', storage,
    eventTarget: { addEventListener: (_name, listener) => { storageListener = listener; } },
    location: { href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/' },
    fetchImpl: async () => logoutResponse
  });

  const pending = client.signOut();
  storage.removeItem('earthRadio.auth.session.v1');
  storageListener({ key: 'earthRadio.auth.session.v1' });
  resolveLogout(new Response(null, { status: 204 }));

  assert.equal(await pending, true);
  assert.equal(storage.getItem('earthRadio.auth.session.v1'), null);
});

test('same-user cross-tab refresh is preserved during sign-out', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'old', refresh_token: 'old-refresh', expires_at: 4102444800,
    user: { id: 'user-a' }
  }));
  let storageListener;
  let resolveLogout;
  const logoutResponse = new Promise(resolve => { resolveLogout = resolve; });
  const client = createAuthClient({
    url: 'https://project.supabase.co', publishableKey: 'sb_publishable_test', storage,
    eventTarget: { addEventListener: (_name, listener) => { storageListener = listener; } },
    location: { href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/' },
    fetchImpl: async () => logoutResponse
  });

  const pending = client.signOut();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'new', refresh_token: 'new-refresh', expires_at: 4102444800,
    user: { id: 'user-a' }
  }));
  storageListener({ key: 'earthRadio.auth.session.v1' });
  resolveLogout(new Response(null, { status: 204 }));

  assert.equal(await pending, false);
  assert.equal(JSON.parse(storage.getItem('earthRadio.auth.session.v1')).access_token, 'new');
});

test('sign-out quiesces queued reloads before a slow logout can finish', async () => {
  let reloadFired = false;
  let generation = 0;
  let reloadTimer = setTimeout(() => { reloadFired = true; }, 10);
  const syncTimer = setInterval(() => {}, 10);

  const nextSyncTimer = quiesceSignOut({
    cancelReload: () => {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    },
    syncTimer,
    invalidateSync: () => { generation += 1; }
  });
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(reloadFired, false);
  assert.equal(reloadTimer, null);
  assert.equal(nextSyncTimer, null);
  assert.equal(generation, 1);

  const root = path.resolve(import.meta.dirname, '..');
  const source = await readFile(path.join(root, 'site', 'assets', 'auth-ui.js'), 'utf8');
  const handler = source.slice(source.indexOf("signOut.addEventListener('click'"), source.indexOf("const actions = el('div', 'er-auth-actions')"));
  assert.ok(handler.indexOf('quiesceSignOut') < handler.indexOf('await auth.signOut()'));
  assert.match(handler, /if \(!signedOut\)[\s\S]*location\.reload\(\)[\s\S]*return/);
});

test('definitive user validation failure clears the invalid session', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'invalid', refresh_token: 'invalid', expires_at: 4102444800,
    user: { id: 'user-1' }
  }));
  const events = [];
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    location: { href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/' },
    fetchImpl: async () => jsonResponse({ error: 'invalid token' }, 401)
  });
  client.onAuthStateChange((event, session) => events.push([event, session]));

  await assert.rejects(client.getUser(), error => error?.status === 401);

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
  assert.equal(result.downloaded, 1);
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

test('auth transitions use the same string-only nonempty namespace contract as storage recovery', () => {
  for (const value of [null, undefined, '', false, 0]) {
    assert.equal(syncNamespaceForAccount(value), 'default');
  }
  assert.equal(syncNamespaceForAccount('0'), 'account:0');
  assert.equal(syncNamespaceForAccount('user/a@example.test'), 'account:user%2Fa%40example.test');
});

test('a delayed tab resets even after another tab already activated the new account', () => {
  assert.equal(shouldResetBrowserAccount('user-b', 'user-a', 'user-b'), true);
  assert.equal(shouldResetBrowserAccount('user-b', 'user-b', 'user-b'), false);
  assert.equal(shouldResetBrowserAccount(null, null, 'user-b'), false);
  assert.equal(shouldResetBrowserAccount('user-b', null, 'user-b', true), true);
  assert.equal(shouldResetBrowserAccount(null, null, 'user-b', false), false);
});

test('account transitions archive offline data and restore each user namespace', async () => {
  const markerKey = 'earth-radio-storage-generation-v2';
  const values = new Map([
    ['favorites', { a: { uuid: 'a' } }],
    ['recents', [{ uuid: 'a' }]],
    ['prefs', { theme: 'dark' }],
    ['badStations', { badA: { failures: 1 } }],
    ['lastPlayed', { uuid: 'last-a' }],
    [markerKey, { v: 2, namespace: 'account:user-a', generation: 9, savedAt: 90 }],
    [accountDataKey('user-b', 'favorites'), { b: { uuid: 'b' } }],
    [accountDataKey('user-b', 'recents'), [{ uuid: 'b' }]],
    [accountDataKey('user-b', 'prefs'), { theme: 'light' }],
    [accountDataKey('user-b', 'badStations'), { badB: { failures: 2 } }],
    [accountDataKey('user-b', 'lastPlayed'), { uuid: 'last-b' }],
    [accountDataKey('user-b', markerKey), { v: 2, namespace: 'account:user-b', generation: 4, savedAt: 40 }]
  ]);
  const defaults = { favorites: {}, recents: [], prefs: { theme: 'system' }, badStations: {}, lastPlayed: null };
  const apply = (previousUserId, nextUserId) => {
    const current = Object.fromEntries(accountLocalRecords.map(key => [key, values.get(key)]));
    const saved = Object.fromEntries(accountLocalRecords.map(key => [
      key, nextUserId ? values.get(accountDataKey(nextUserId, key)) : undefined
    ]));
    const plan = planLocalAccountTransition({
      previousUserId, nextUserId, current, saved,
      nextNamespaceExists: Boolean(nextUserId) && values.has(accountDataKey(nextUserId, 'favorites')),
      defaults
    });
    for (const [key, value] of plan.writes) values.set(key, value);
    return plan;
  };

  apply('user-a', 'user-b');

  assert.deepEqual(values.get(accountDataKey('user-a', 'favorites')), { a: { uuid: 'a' } });
  assert.deepEqual(values.get(accountDataKey('user-a', 'badStations')), { badA: { failures: 1 } });
  assert.deepEqual(values.get(accountDataKey('user-a', 'lastPlayed')), { uuid: 'last-a' });
  assert.deepEqual(values.get(accountDataKey('user-a', markerKey)), { v: 2, namespace: 'account:user-a', generation: 9, savedAt: 90 });
  assert.deepEqual(values.get('favorites'), { b: { uuid: 'b' } });
  assert.deepEqual(values.get('recents'), [{ uuid: 'b' }]);
  assert.deepEqual(values.get('prefs'), { theme: 'light' });
  assert.deepEqual(values.get('badStations'), { badB: { failures: 2 } });
  assert.deepEqual(values.get('lastPlayed'), { uuid: 'last-b' });
  assert.deepEqual(values.get(markerKey), { v: 2, namespace: 'account:user-b', generation: 4, savedAt: 40 });

  apply('user-b', null);
  assert.deepEqual(values.get(accountDataKey('user-b', 'favorites')), { b: { uuid: 'b' } });
  assert.deepEqual(values.get('favorites'), {});
  assert.deepEqual(values.get('badStations'), {});
  assert.equal(values.get('lastPlayed'), null);
  assert.equal(values.get(markerKey).namespace, 'default');

  apply(null, 'user-a');
  assert.deepEqual(values.get('favorites'), { a: { uuid: 'a' } });
  assert.deepEqual(values.get('prefs'), { theme: 'dark' });
  assert.deepEqual(values.get('badStations'), { badA: { failures: 1 } });
  assert.deepEqual(values.get('lastPlayed'), { uuid: 'last-a' });
  assert.deepEqual(values.get(markerKey), { v: 2, namespace: 'account:user-a', generation: 9, savedAt: 90 });
});

test('first sign-in keeps local records but rebinds the generation marker to the authoritative account', () => {
  const markerKey = 'earth-radio-storage-generation-v2';
  const current = {
    favorites: { local: {} }, recents: [], prefs: { theme: 'dark' }, badStations: {}, lastPlayed: null,
    [markerKey]: { v: 2, namespace: 'default', generation: 3, savedAt: 30 }
  };
  const plan = planLocalAccountTransition({
    previousUserId: null, nextUserId: 'user-a', current, saved: {}, nextNamespaceExists: false,
    defaults: { favorites: {}, recents: [], prefs: {}, badStations: {}, lastPlayed: null }
  });
  assert.deepEqual(plan.writes, [[markerKey, { v: 2, namespace: 'account:user-a', generation: 4, savedAt: 30 }]]);
});

test('the browser account switch uses one IndexedDB readwrite transaction', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const source = await readFile(path.join(root, 'site', 'assets', 'auth-ui.js'), 'utf8');
  const switchBody = source.slice(source.indexOf('async function switchLocalAccount'), source.indexOf('function clearMissingNamespaceSyncState'));
  assert.match(switchBody, /db\.transaction\('kv', 'readwrite'\)/);
  assert.match(switchBody, /transaction\.oncomplete/);
  assert.match(switchBody, /values\.get\(ACTIVE_NAMESPACE_KEY\)/);
  assert.match(switchBody, /namespaceMissing: storedNamespace === undefined/);
  assert.match(switchBody, /store\.put\(nextUserId \|\| null, ACTIVE_NAMESPACE_KEY\)/);
  assert.match(switchBody, /accountLocalRecords/);
  assert.doesNotMatch(switchBody, /await kv\(/);
});

test('disabled authentication detaches any active local account namespace', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const source = await readFile(path.join(root, 'site', 'assets', 'auth-ui.js'), 'utf8');
  const bootPrefix = source.slice(source.indexOf('async function boot'), source.indexOf("const stylesheet"));
  assert.match(bootPrefix, /if \(!config\?\.enabled\)[\s\S]*switchLocalAccount\(activeUserId, null\)/);
  assert.match(bootPrefix, /localStorage\.removeItem\(ACTIVE_USER_KEY\)/);
  assert.match(bootPrefix, /location\.reload\(\)/);
});

test('authenticated boot verifies IndexedDB and keeps sync running after transient profile failure', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const source = await readFile(path.join(root, 'site', 'assets', 'auth-ui.js'), 'utf8');
  const bootTail = source.slice(source.indexOf('session = await auth.initialize()'), source.lastIndexOf('\n}'));
  assert.match(bootTail, /switchLocalAccount\(previousUserId, nextUserId\)/);
  assert.match(bootTail, /clearMissingNamespaceSyncState\(nextUserId, transition\)/);
  assert.match(bootTail, /try \{ await refreshUser\(\); \}[\s\S]*if \(session && !resettingSession\) startSync\(\)/);
});

test('downloads during the reload cooldown schedule a later reload', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const source = await readFile(path.join(root, 'site', 'assets', 'auth-ui.js'), 'utf8');
  const syncBody = source.slice(source.indexOf('async function runSync'), source.indexOf('function startSync'));
  assert.match(syncBody, /const reloadDelay = Math\.max\(0, 5000 - \(Date\.now\(\) - lastReload\)\)/);
  assert.match(syncBody, /reloadTimer = setTimeout\([\s\S]*reloadDelay\)/);
});

test('sync local access is fenced by the active account in the same IndexedDB transaction', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const source = await readFile(path.join(root, 'site', 'assets', 'auth-ui.js'), 'utf8');
  const accountKvBody = source.slice(source.indexOf('async function accountKv'), source.indexOf('function el'));
  const syncBody = source.slice(source.indexOf('async function runSync'), source.indexOf('function startSync'));
  assert.match(accountKvBody, /db\.transaction\('kv', operation === 'get' \? 'readonly' : 'readwrite'\)/);
  assert.match(accountKvBody, /store\.get\(ACTIVE_NAMESPACE_KEY\)/);
  assert.match(accountKvBody, /storedNamespace !== userId/);
  assert.match(accountKvBody, /transaction\.abort\(\)/);
  assert.match(syncBody, /readLocal: async key =>[\s\S]*accountKv\('get', key, undefined, userId\)/);
  assert.match(syncBody, /writeLocal: async \(key, value\) =>[\s\S]*accountKv\('put', key, value, userId\)/);
  assert.match(syncBody, /writeLocalIfUnchanged:[\s\S]*accountKv\('comparePut'/);
});

test('REST requests reject a session belonging to a different expected account', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'b', refresh_token: 'b', expires_at: 4102444800, user: { id: 'user-b' }
  }));
  let requests = 0;
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    location: { href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/' },
    fetchImpl: async () => { requests += 1; return jsonResponse([]); }
  });

  await assert.rejects(
    client.rest('user_config_documents', { expectedUserId: 'user-a' }),
    error => error?.code === 'ACCOUNT_CHANGED'
  );
  assert.equal(requests, 0);
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

test('an in-flight refresh cannot overwrite a cross-tab replacement session', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'a-old', refresh_token: 'a-refresh', expires_at: 1, user: { id: 'user-a' }
  }));
  let storageListener;
  let resolveRefresh;
  const refreshResponse = new Promise(resolve => { resolveRefresh = resolve; });
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    eventTarget: { addEventListener: (_name, listener) => { storageListener = listener; } },
    location: { href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/' },
    fetchImpl: async () => refreshResponse
  });
  const events = [];
  client.onAuthStateChange((event, session) => events.push([event, session?.user?.id]));
  const pending = client.getSession();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'b', refresh_token: 'b-refresh', expires_at: 4102444800, user: { id: 'user-b' }
  }));
  storageListener({ key: 'earthRadio.auth.session.v1' });
  resolveRefresh(jsonResponse({
    access_token: 'a-new', refresh_token: 'a-refresh', expires_in: 3600, user: { id: 'user-a' }
  }));

  const session = await pending;

  assert.equal(session.user.id, 'user-b');
  assert.equal(JSON.parse(storage.getItem('earthRadio.auth.session.v1')).user.id, 'user-b');
  assert.deepEqual(events, [['SIGNED_IN', 'user-b']]);
});

test('a stale failed refresh cannot sign out a cross-tab replacement session', async () => {
  const storage = memoryStorage();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'a-old', refresh_token: 'a-refresh', expires_at: 1, user: { id: 'user-a' }
  }));
  let storageListener;
  let resolveRefresh;
  const refreshResponse = new Promise(resolve => { resolveRefresh = resolve; });
  const client = createAuthClient({
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_test',
    storage,
    eventTarget: { addEventListener: (_name, listener) => { storageListener = listener; } },
    location: { href: 'https://earth-radio.example/', origin: 'https://earth-radio.example', pathname: '/' },
    fetchImpl: async () => refreshResponse
  });
  const events = [];
  client.onAuthStateChange((event, session) => events.push([event, session?.user?.id]));
  const pending = client.getSession();
  storage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    access_token: 'b', refresh_token: 'b-refresh', expires_at: 4102444800, user: { id: 'user-b' }
  }));
  storageListener({ key: 'earthRadio.auth.session.v1' });
  resolveRefresh(jsonResponse({ error: 'invalid refresh token' }, 401));

  const session = await pending;

  assert.equal(session.user.id, 'user-b');
  assert.equal(JSON.parse(storage.getItem('earthRadio.auth.session.v1')).user.id, 'user-b');
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

test('a remote download cannot overwrite a newer local edit', async () => {
  const base = { old: { uuid: 'old' } };
  const newerLocal = { new: { uuid: 'new' } };
  const remoteValue = { remote: { uuid: 'remote' } };
  const local = { favorites: base, recents: [], prefs: {} };
  const state = {
    favorites: { revision: 1, hash: stableStringify(base), value: base },
    recents: { revision: 1, hash: stableStringify([]), value: [] },
    prefs: { revision: 1, hash: stableStringify({}), value: {} }
  };
  const engine = createSyncEngine({
    readLocal: async key => local[key],
    writeLocal: async (key, value) => { local[key] = value; },
    writeLocalIfUnchanged: async (key, expected, value) => {
      if (key === 'favorites') local[key] = newerLocal;
      if (stableStringify(local[key]) !== stableStringify(expected)) return false;
      local[key] = value;
      return true;
    },
    readState: async key => state[key] ?? null,
    writeState: async (key, value) => { state[key] = value; },
    fetchRemote: async () => [
      { document_key: 'favorites', revision: 2, value: remoteValue, deleted_at: null },
      { document_key: 'recents', revision: 1, value: [], deleted_at: null },
      { document_key: 'preferences', revision: 1, value: {}, deleted_at: null }
    ],
    upsertRemote: async () => null
  });

  const result = await engine.syncOnce();

  assert.deepEqual(local.favorites, newerLocal);
  assert.equal(state.favorites.revision, 1);
  assert.equal(result.downloaded, 0);
  assert.equal(result.conflicts, 1);
});

test('production auth excludes Cloudflare preview origins', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const runtimeConfig = await readFile(path.join(root, 'site', 'config.js'), 'utf8');
  const supabaseConfig = await readFile(path.join(root, 'supabase', 'config.toml'), 'utf8');
  assert.match(runtimeConfig, /authOriginAllowed/);
  assert.match(runtimeConfig, /https:\/\/earth-radio\.pages\.dev/);
  assert.doesNotMatch(runtimeConfig, /localhost|127\.0\.0\.1/);
  assert.doesNotMatch(runtimeConfig, /\*\.earth-radio\.pages\.dev/);
  assert.doesNotMatch(supabaseConfig, /\*\.earth-radio\.pages\.dev/);
});
