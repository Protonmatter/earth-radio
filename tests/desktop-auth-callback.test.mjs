import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { beginAuthCallback } from '../electron/auth-callback.mjs';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { agent: false, ...options }, res => {
      let body = '';
      res.setEncoding('utf8').on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject).end();
  });
}

test('callback requires exact Host, path, method and a single bounded code before consuming a flow', async t => {
  const codes = [];
  const flow = await beginAuthCallback({ onCode: async code => { codes.push(code); return 'signed-in'; } });
  t.after(() => flow.close());
  const url = new URL(flow.url);
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/earth-radio-auth\/callback\/[A-Za-z0-9_-]{43}$/);
  assert.equal((await request(`${flow.url}?code=good`, { headers: { Host: `evil.example:${url.port}` } })).status, 400);
  assert.equal((await request(`${url.origin}/wrong?code=good`)).status, 404);
  assert.equal((await request(`${flow.url}?code=good`, { method: 'POST' })).status, 405);
  assert.equal((await request(`${flow.url}?code=a&code=b`)).status, 400);
  assert.equal((await request(`${flow.url}?code=${'a'.repeat(5000)}`)).status, 414);
  assert.equal((await request(`${flow.url}?code=good&unexpected=value`)).status, 400);
  assert.deepEqual(codes, []);
  const response = await request(`${flow.url}?code=opaque-code`);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.doesNotMatch(response.body, /opaque-code/);
  assert.equal(await flow.result, 'signed-in');
  assert.deepEqual(codes, ['opaque-code']);
  await flow.close();
  await assert.rejects(request(`${flow.url}?code=replay`));
});

test('callback consumes at most once while exchange is pending', async t => {
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  let count = 0;
  const flow = await beginAuthCallback({ onCode: async () => { count++; return new Promise(resolve => { release = resolve; began(); }); } });
  t.after(() => flow.close());
  const first = request(`${flow.url}?code=first`);
  await started;
  assert.equal(typeof release, 'function');
  assert.equal((await request(`${flow.url}?code=replay`)).status, 409);
  release('done');
  assert.equal((await first).status, 200);
  assert.equal(await flow.result, 'done');
  assert.equal(count, 1);
});

test('callback error text is static and timeout/cancellation close the listener', async () => {
  const denied = await beginAuthCallback({ onCode: () => assert.fail('must not exchange') });
  const response = await request(`${denied.url}?error=access_denied&error_description=secret-description`);
  assert.equal(response.status, 400);
  assert.doesNotMatch(response.body, /secret-description/);
  await assert.rejects(denied.result, /not completed/i);
  await denied.close();
  const timeout = await beginAuthCallback({ onCode: () => {}, timeoutMs: 25 });
  await assert.rejects(timeout.result, /expired/i);
  await timeout.close();
  await assert.rejects(request(`${timeout.url}?code=late`));
  const canceled = await beginAuthCallback({ onCode: () => {} });
  await canceled.cancel();
  await assert.rejects(canceled.result, /canceled/i);
  await assert.rejects(request(`${canceled.url}?code=late`));
});

test('cancellation during token exchange cannot accept the late result', async () => {
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const flow = await beginAuthCallback({ onCode: () => new Promise(resolve => { release = resolve; began(); }) });
  const incoming = request(`${flow.url}?code=first`).catch(() => null);
  await started;
  assert.equal(typeof release, 'function');
  await flow.cancel();
  release('late');
  await assert.rejects(flow.result, /canceled/i);
  await incoming;
});
