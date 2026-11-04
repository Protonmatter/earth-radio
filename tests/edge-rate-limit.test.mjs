import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { advanceQuota, LIMITS, WINDOW_MS } from '../workers/rate-limit/policy.mjs';
import { canonicalClientIp, enforceMetadataQuota, quotaKind, quotaObjectName } from '../functions/_shared/rate-limit.js';

for (const [kind, limit] of Object.entries(LIMITS)) {
  test(`${kind} allows its exact budget then blocks for sixty seconds without extending on retries`, () => {
    let state;
    for (let i = 0; i < limit; i++) {
      const result = advanceQuota(state, limit, 1000);
      assert.equal(result.allowed, true);
      assert.equal(result.remaining, limit - i - 1);
      state = result.state;
    }
    const denied = advanceQuota(state, limit, 1001);
    assert.equal(denied.allowed, false);
    assert.equal(denied.retryAfter, 60);
    const retry = advanceQuota(denied.state, limit, 31001);
    assert.equal(retry.allowed, false);
    assert.equal(retry.retryAfter, 30);
    assert.equal(retry.state.blockedUntil, denied.state.blockedUntil);
    const recovered = advanceQuota(retry.state, limit, 61001);
    assert.equal(recovered.allowed, true);
    assert.equal(recovered.remaining, limit - 1);
  });
}

test('quota state survives serialization and handles window expiry/clock rollback conservatively', () => {
  const first = advanceQuota(null, 1, 5000);
  const restored = JSON.parse(JSON.stringify(first.state));
  assert.equal(advanceQuota(restored, 1, 4000).allowed, false);
  assert.equal(advanceQuota(restored, 1, 5000 + WINDOW_MS).allowed, true);
  assert.throws(() => advanceQuota({ used: '30' }, 30, 5000), /stored quota/);
  assert.throws(() => advanceQuota(null, 30, NaN), /quota input/);
});

test('minute-boundary bursts cannot double a rolling request budget', () => {
  for (const limit of Object.values(LIMITS)) {
    let state = advanceQuota(null, limit, 1000).state;
    for (let i = 1; i < limit; i++) state = advanceQuota(state, limit, 60999).state;
    const boundary = advanceQuota(state, limit, 61000);
    assert.equal(boundary.allowed, true);
    assert.equal(boundary.remaining, 0);
    assert.equal(advanceQuota(boundary.state, limit, 61000).allowed, false);
  }
});

test('route normalization closes encoded/slash aliases and refuses unknown API routes', () => {
  for (const path of ['/api/nowplaying', '/api/nowplaying/', '/api/%6eowplaying', '//api//nowplaying']) assert.equal(quotaKind(path), 'nowplaying');
  assert.equal(quotaKind('/api/track/fingerprint'), 'fingerprint');
  assert.equal(quotaKind('/api/%256eowplaying'), null);
  assert.equal(quotaKind('/api/unknown'), null);
});

test('trusted IP canonicalization and scope hashing never put raw addresses into object names', async () => {
  assert.equal(canonicalClientIp('2001:0db8:0:0:0:0:0:1'), '2001:db8::1');
  assert.equal(canonicalClientIp('192.0.2.4'), '192.0.2.4');
  for (const input of ['', 'client.example', '192.0.2.4,1.1.1.1', '999.0.0.1', '::1%zone']) assert.equal(canonicalClientIp(input), null);
  const production = await quotaObjectName('production', '192.0.2.4');
  assert.match(production, /^v1:[a-f0-9]{64}$/);
  assert.equal(await quotaObjectName('production', '192.0.2.4'), production);
  assert.notEqual(await quotaObjectName('preview', '192.0.2.4'), production);
  assert.notEqual(await quotaObjectName('production', '192.0.2.5'), production);
  await assert.rejects(quotaObjectName('attacker', '192.0.2.4'), /identity/);
});

function context({ path = '/api/nowplaying', ip = '192.0.2.4', binding, headers = {}, method = 'GET', scope = 'production', host = 'earth-radio.pages.dev' } = {}) {
  let calls = 0;
  return {
    request: new Request(`https://${host}${path}`, { method, headers: { ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...headers } }),
    env: binding ? { METADATA_LIMITS: binding, METADATA_LIMIT_SCOPE: scope } : {},
    async next() { calls++; return new Response('metadata work', { headers: { 'cache-control': 'public, max-age=60' } }); },
    get calls() { return calls; }
  };
}

test('the middleware blocks concurrent excess requests before any metadata work, including probes/cache hits', async () => {
  const states = new Map();
  const binding = { getByName(name) { return { async check(kind) {
    const key = `${name}:${kind}`;
    const decision = advanceQuota(states.get(key), LIMITS[kind], 1000);
    states.set(key, decision.state);
    return decision;
  } }; } };
  for (const [path, limit] of [['/api/nowplaying', 30], ['/api/track/fingerprint', 6]]) {
    const requests = Array.from({ length: limit + 2 }, () => context({ path, binding }));
    const responses = await Promise.all(requests.map(enforceMetadataQuota));
    assert.equal(responses.filter(r => r.status === 200).length, limit);
    assert.equal(responses.filter(r => r.status === 429).length, 2);
    assert.equal(requests.reduce((sum, request) => sum + request.calls, 0), limit);
    for (const response of responses) assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(responses.find(r => r.status === 429).headers.get('retry-after'), '60');
  }
});

test('missing bindings/identity and unavailable or malformed counters fail closed', async () => {
  const good = { getByName() { return { check: async () => ({ allowed: true, remaining: 29, retryAfter: 0 }) }; } };
  const bad = { getByName() { return { check: async () => { throw new Error('private infrastructure detail'); } }; } };
  const malformed = { getByName() { return { check: async () => ({ allowed: 'yes' }) }; } };
  for (const options of [{}, { binding: good, scope: null }, { binding: good, ip: null, headers: { 'X-Forwarded-For': '192.0.2.4' } }, { binding: bad }, { binding: malformed }]) {
    const input = context(options), response = await enforceMetadataQuota(input);
    assert.equal(response.status, 503);
    assert.equal(input.calls, 0);
    assert.doesNotMatch(await response.text(), /private infrastructure/);
  }
});

test('production aliases share their environment budget and cannot impersonate preview scope', async () => {
  const names = [];
  const binding = { getByName(name) { names.push(name); return { check: async () => ({ allowed: true, remaining: 29, retryAfter: 0 }) }; } };
  for (const host of ['earth-radio.pages.dev', 'deadbeef.earth-radio.pages.dev']) await enforceMetadataQuota(context({ binding, host }));
  assert.equal(names[0], names[1]);
  await enforceMetadataQuota(context({ binding, scope: 'preview', host: 'preview.earth-radio.pages.dev' }));
  assert.notEqual(names[0], names[2]);
});

test('deployment configuration keeps the limiter private and binds both explicit environment scopes', async () => {
  const worker = JSON.parse(await readFile(new URL('../workers/rate-limit/wrangler.jsonc', import.meta.url), 'utf8'));
  const pages = JSON.parse((await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')).split('\n').filter(line => !line.trim().startsWith('//')).join('\n'));
  assert.equal(worker.workers_dev, false); assert.equal(worker.preview_urls, false);
  assert.ok(worker.migrations.some(migration => migration.new_sqlite_classes?.includes('MetadataRateLimit')));
  for (const scope of ['production', 'preview']) {
    assert.equal(pages.env[scope].vars.METADATA_LIMIT_SCOPE, scope);
    const binding = pages.env[scope].durable_objects.bindings.find(binding => binding.name === 'METADATA_LIMITS');
    assert.equal(binding.script_name, worker.name); assert.equal(binding.class_name, 'MetadataRateLimit');
  }
});

test('visitor-controlled forwarding headers cannot select another quota identity', async () => {
  const names = [];
  const binding = { getByName(name) { names.push(name); return { check: async () => ({ allowed: true, remaining: 29, retryAfter: 0 }) }; } };
  for (const address of ['203.0.113.1', '203.0.113.2']) await enforceMetadataQuota(context({ binding, headers: { 'X-Forwarded-For': address } }));
  assert.equal(names[0], names[1]);
});

test('unknown routes and unsupported methods cannot fall through to unmetered handlers', async () => {
  for (const [options, status] of [[{ path: '/api/unknown' }, 404], [{ method: 'POST' }, 405]]) {
    const input = context(options);
    assert.equal((await enforceMetadataQuota(input)).status, status);
    assert.equal(input.calls, 0);
  }
});
