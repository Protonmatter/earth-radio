import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDesktopAuthManager } from '../electron/auth-manager.mjs';
import { authStorageKeys, createAuthClient } from '../site/assets/auth-core.js';

const config = { url: 'https://project.supabase.co', publishableKey: 'sb_publishable_test' };
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const session = { access_token: 'secret-access', refresh_token: 'secret-refresh', expires_in: 3600,
  user: { id: 'user-a', email: 'test@example.test', identities: [{ provider: 'google', identity_data: { secret: 'not-display-data' } }] } };

test('native core exchanges only an active PKCE flow and rejects a canceled in-flight exchange', async () => {
  const assigned = [];
  let finish, began;
  const started = new Promise(resolve => { began = resolve; });
  const client = createAuthClient({ ...config, storage: storage(), sessionStorageImpl: storage(), cookieJar: { read: () => null, write() {}, clear() {} },
    location: { origin: 'https://earth-radio.example', href: 'https://earth-radio.example/', assign: async url => assigned.push(url) },
    resolveRedirect: () => 'http://127.0.0.1:1234/earth-radio-auth/callback/nonce',
    fetchImpl: async () => new Promise(resolve => { finish = () => resolve(json(session)); began(); }) });
  await client.signInWithOAuth('google');
  assert.equal(new URL(assigned[0]).searchParams.get('redirect_to'), 'http://127.0.0.1:1234/earth-radio-auth/callback/nonce');
  const pending = client.exchangeCode('code');
  await started;
  assert.equal(typeof finish, 'function');
  client.cancelPendingSignIn();
  finish();
  await assert.rejects(pending, /canceled|changed/i);
  assert.equal(await client.getSession(), null);
});

async function fixture(t) {
  const opened = [], events = [], requests = [], store = storage();
  let challenge;
  const vault = { storage: store, flush: async () => {} };
  const manager = createDesktopAuthManager({ config, vault, openExternal: async url => { opened.push(url); challenge = new URL(url).searchParams.get('code_challenge'); },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      const u = new URL(url);
      if (u.pathname.endsWith('/settings')) return json({ external: { google: true, github: true, email: true } });
      if (u.pathname.endsWith('/token')) {
        const body = JSON.parse(init.body);
        if (u.searchParams.get('grant_type') === 'pkce') assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), challenge);
        return json(session);
      }
      if (u.pathname.endsWith('/user')) return json(session.user);
      if (u.pathname.endsWith('/logout')) return json({});
      if (u.pathname.endsWith('/otp')) return json({});
      if (u.pathname.endsWith('/user_config_documents')) return json([{ document_key: 'favorites', value: {}, revision: 1 }]);
      if (u.pathname.endsWith('/rpc/upsert_user_config_document')) return json([{ revision: 2 }]);
      assert.fail('Unexpected API route');
    } });
  manager.subscribe(value => events.push(value));
  t.after(() => manager.close());
  return { manager, opened, events, requests, store };
}

test('main owns PKCE/tokens and returns only safe profile metadata after loopback exchange', async t => {
  const { manager, opened, events, store } = await fixture(t);
  await manager.execute('signIn', { provider: 'google' });
  const authorize = new URL(opened[0]);
  assert.equal(authorize.origin, config.url);
  assert.equal(authorize.searchParams.get('prompt'), 'select_account');
  const response = await fetch(`${authorize.searchParams.get('redirect_to')}?code=authorized`);
  assert.equal(response.status, 200);
  const current = await manager.execute('session');
  assert.equal(current.user.id, 'user-a');
  assert.deepEqual(current.user.identities, [{ provider: 'google' }]);
  assert.ok(store.getItem(authStorageKeys.session).includes('secret-refresh'));
  assert.doesNotMatch(JSON.stringify([current, events, await manager.execute('user')]), /secret-|access_token|refresh_token|identity_data|code_verifier/);
  const docs = await manager.execute('readDocuments', { expectedUserId: 'user-a' });
  assert.equal(docs[0].revision, 1);
  await assert.rejects(manager.execute('readDocuments', { expectedUserId: 'user-b' }), /account|authentication/i);
  await manager.execute('signOut');
  assert.equal(await manager.execute('session'), null);
  assert.equal(store.getItem(authStorageKeys.session), null);
});

test('main refuses arbitrary scopes, providers, RPCs, document keys and oversized requests', async t => {
  const { manager, opened, requests } = await fixture(t);
  for (const [op, input] of [
    ['signIn', { provider: 'evil' }], ['signIn', { provider: 'google', scopes: 'admin' }],
    ['rest', { path: 'profiles' }], ['rpc', { name: 'anything' }],
    ['upsertDocument', { expectedUserId: 'user-a', body: { p_document_key: 'private-key' } }],
    ['email', { email: 'a'.repeat(400) + '@example.test' }]
  ]) await assert.rejects(manager.execute(op, input));
  assert.deepEqual(opened, []);
  assert.deepEqual(requests, []);
});

test('superseding or signing out cancels the previous browser return', async t => {
  const { manager, opened } = await fixture(t);
  await manager.execute('signIn', { provider: 'google' });
  const previous = new URL(opened[0]).searchParams.get('redirect_to');
  await manager.execute('signIn', { provider: 'github' });
  await assert.rejects(fetch(`${previous}?code=stale`));
  const current = new URL(opened[1]).searchParams.get('redirect_to');
  await manager.execute('signOut');
  await assert.rejects(fetch(`${current}?code=stale`));
  assert.equal(await manager.execute('session'), null);
});

test('native immediate logout fences an already-running refresh before remote revocation returns', async () => {
  const store = storage();
  store.setItem(authStorageKeys.session, JSON.stringify({ ...session, expires_at: 1 }));
  let refreshDone, logoutDone;
  const client = createAuthClient({ ...config, storage: store, eventTarget: null,
    fetchImpl: async url => new Promise(resolve => {
      if (String(url).includes('/token')) refreshDone = () => resolve(json(session));
      else logoutDone = () => resolve(json({}));
    }) });
  const refreshing = client.getSession();
  const leaving = client.signOut({ immediate: true });
  assert.equal(store.getItem(authStorageKeys.session), null);
  refreshDone();
  assert.equal(await refreshing, null);
  logoutDone();
  assert.equal(await leaving, true);
  assert.equal(await client.getSession(), null);
});

test('simultaneous sign-in starts leave only the newest callback active', async t => {
  const before = process.getActiveResourcesInfo().filter(type => type === 'TCPServerWrap').length;
  const { manager, opened } = await fixture(t);
  const results = await Promise.allSettled([
    manager.execute('signIn', { provider: 'google' }),
    manager.execute('signIn', { provider: 'github' })
  ]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0]).searchParams.get('provider'), 'github');
  await manager.close();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(process.getActiveResourcesInfo().filter(type => type === 'TCPServerWrap').length <= before, 'Superseded attempts must not leak listeners.');
});

test('native sync preserves the existing large-favorites contract and enforces per-document byte limits', async t => {
  const store = storage();
  store.setItem(authStorageKeys.session, JSON.stringify(session));
  const large = { station: { summary: 'x'.repeat(1100000) } };
  const manager = createDesktopAuthManager({ config, vault: { storage: store, flush: async () => {} }, openExternal: async () => {},
    fetchImpl: async url => json(String(url).includes('/rpc/') ? [{ revision: 1 }] : [{ document_key: 'favorites', value: large, revision: 1 }]) });
  t.after(() => manager.close());
  const result = await manager.execute('upsertDocument', { expectedUserId: 'user-a', body: {
    p_document_key: 'favorites', p_value: large, p_expected_revision: 0, p_delete: false
  } });
  assert.equal(result[0].revision, 1);
  assert.equal((await manager.execute('readDocuments', { expectedUserId: 'user-a' }))[0].value.station.summary.length, 1100000);
  for (const key of ['recents', 'preferences']) await assert.rejects(manager.execute('upsertDocument', { expectedUserId: 'user-a', body: {
    p_document_key: key, p_value: large, p_expected_revision: 0, p_delete: false
  } }), /invalid/i);
});

for (const stage of ['refresh', 'identity-response']) test(`superseded identity linking cannot resume after deferred ${stage}`, async t => {
  const store = storage();
  store.setItem(authStorageKeys.session, JSON.stringify({ ...session, ...(stage === 'refresh' ? { expires_at: 1 } : {}) }));
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const opened = [];
  let identityRequests = 0;
  const manager = createDesktopAuthManager({ config, vault: { storage: store, flush: async () => {} },
    openExternal: async url => { opened.push(url); }, fetchImpl: async (value, init) => {
      const url = new URL(value);
      if (url.searchParams.get('grant_type') === 'refresh_token') return new Promise(resolve => {
        release = () => resolve(json(session)); began();
      });
      if (url.pathname.endsWith('/user/identities/authorize')) {
        identityRequests++;
        if (stage === 'identity-response') return new Promise(resolve => {
          release = () => resolve(json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=example' })); began();
        });
        return json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=example' });
      }
      if (url.searchParams.get('grant_type') === 'pkce') {
        const body = JSON.parse(init.body);
        assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), new URL(opened[0]).searchParams.get('code_challenge'));
        return json(session);
      }
      assert.fail('Unexpected deferred-link endpoint');
    } });
  t.after(() => manager.close());
  const old = manager.execute('link', { provider: 'google' });
  const oldResult = assert.rejects(old);
  await started;
  await manager.execute('signIn', { provider: 'github' });
  const verifier = store.getItem(authStorageKeys.pkce);
  release();
  await oldResult;
  assert.equal(opened.length, 1);
  assert.equal(store.getItem(authStorageKeys.pkce), verifier);
  if (stage === 'refresh') assert.equal(identityRequests, 0);
  const callback = new URL(opened[0]).searchParams.get('redirect_to');
  assert.equal((await fetch(`${callback}?code=current-code`)).status, 200);
  assert.equal((await manager.execute('session')).user.id, 'user-a');
});
