import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopAuthClient, isDesktopAuthAvailable } from '../site/assets/desktop-auth.js';

test('native adapter requires a file document and rejects generic authenticated requests', async () => {
  const calls = [];
  let event;
  const bridge = { invoke: async (operation, input) => { calls.push({ operation, input }); return { ok: true, value: operation === 'session' ? { user: { id: 'a' } } : true }; },
    subscribe: callback => { event = callback; return () => { event = null; }; } };
  assert.equal(isDesktopAuthAvailable({ isDesktop: true, auth: bridge }, { protocol: 'file:', origin: 'null' }), true);
  assert.equal(isDesktopAuthAvailable({ isDesktop: true, auth: bridge }, { protocol: 'file:', origin: 'file://' }), true);
  assert.equal(isDesktopAuthAvailable({ isDesktop: true, auth: bridge }, { protocol: 'https:', origin: 'https://earth-radio.pages.dev' }), false);
  assert.equal(isDesktopAuthAvailable({ isDesktop: true }, { protocol: 'file:', origin: 'null' }), false);
  const auth = createDesktopAuthClient(bridge);
  assert.equal((await auth.getSession()).user.id, 'a');
  await auth.signInWithOAuth('google', { scopes: 'ignored-untrusted-scope' });
  assert.deepEqual(calls.at(-1), { operation: 'signIn', input: { provider: 'google' } });
  await assert.rejects(auth.rest('profiles', { expectedUserId: 'a' }));
  await assert.rejects(auth.rpc('arbitrary_function', {}, { expectedUserId: 'a' }));
  const seen = [];
  const unsubscribe = auth.onAuthStateChange((...args) => seen.push(args));
  event({ event: 'SIGNED_IN', session: { user: { id: 'a' } } });
  assert.deepEqual(seen, [['SIGNED_IN', { user: { id: 'a' } }, undefined]]);
  unsubscribe();
  assert.equal(event, null);
});
