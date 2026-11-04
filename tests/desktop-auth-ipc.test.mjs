import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthIpc, installAuthNavigationPolicy } from '../electron/auth-ipc-policy.mjs';

test('auth IPC accepts only the owned top-level trusted document, with bounded explicit operations', async () => {
  const frame = { url: 'file:///trusted/site/index.html#station=one' };
  const webContents = { mainFrame: frame, isDestroyed: () => false };
  const manager = { execute: async () => ({ user: { id: 'user-a' } }) };
  const trusted = { sender: webContents, senderFrame: frame };
  const call = (event, request = { operation: 'session' }) => handleAuthIpc({ event, request, webContents, documentUrl: 'file:///trusted/site/index.html', manager });
  assert.deepEqual(await call(trusted), { ok: true, value: { user: { id: 'user-a' } } });
  for (const event of [{}, { ...trusted, sender: {} }, { ...trusted, senderFrame: { url: frame.url } }, { ...trusted, senderFrame: null }]) {
    assert.equal((await call(event)).ok, false);
  }
  frame.url = 'https://earth-radio.pages.dev/';
  assert.equal((await call(trusted)).ok, false);
  frame.url = 'file:///trusted/site/index.html?injected=true';
  assert.equal((await call(trusted)).ok, false);
  frame.url = 'file:///trusted/site/index.html';
  assert.equal((await call(trusted, { operation: 'session', secret: 'unexpected' })).ok, false);
  assert.equal((await call(trusted, { operation: 'rpc' })).ok, false);
  manager.execute = async () => { throw new Error('secret-refresh backend URL?code=secret-code'); };
  const failure = await call(trusted);
  assert.equal(failure.ok, false);
  assert.doesNotMatch(JSON.stringify(failure), /secret-refresh|secret-code|backend/);
});

test('navigation policy permits only trusted self reloads and never remote redirects', () => {
  const handlers = new Map();
  installAuthNavigationPolicy({ on: (event, callback) => handlers.set(event, callback) }, 'file:///trusted/site/index.html');
  for (const [url, expected] of [['file:///trusted/site/index.html', false], ['file:///trusted/site/index.html#station=one', false],
    ['file:///trusted/site/index.html?injected=true', true], ['file:///other.html', true], ['https://earth-radio.pages.dev/', true]]) {
    let prevented = false;
    handlers.get('will-navigate')({ url, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, expected);
  }
  let prevented = false;
  handlers.get('will-redirect')({ url: 'file:///trusted/site/index.html', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});
