import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('the live immutable runtime filename is derived from its final content hash everywhere', async () => {
  const html = await readFile(path.join(root, 'site', 'index.html'), 'utf8');
  const headers = await readFile(path.join(root, 'site', '_headers'), 'utf8');
  const worker = await readFile(path.join(root, 'site', 'sw.js'), 'utf8');
  const match = html.match(/assets\/(index-([A-Za-z0-9_-]{8})\.js)/);
  assert.ok(match, 'index.html has no eight-character immutable runtime filename');
  const [relativeName, nameHash] = [match[1], match[2]];
  const content = await readFile(path.join(root, 'site', 'assets', relativeName));
  const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 8);
  assert.equal(nameHash, contentHash, 'immutable runtime filename does not match final content');
  assert.match(headers, new RegExp(`/assets/${relativeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
  assert.match(worker, new RegExp(relativeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('service worker registers even when async startup outlives window load', async () => {
  const source = await readFile(path.join(root, 'src-recovered', 'main.ts'), 'utf8');
  const bundle = await readFile(path.join(root, 'site', 'assets', 'index-690938fe.js'), 'utf8');
  assert.match(source, /document\.readyState === 'complete'/);
  assert.match(bundle, /document\.readyState===`complete`/);
});

test('frame-ancestors is delivered as a response header, not ineffective meta policy', async () => {
  const html = await readFile(path.join(root, 'site', 'index.html'), 'utf8');
  const headers = await readFile(path.join(root, 'site', '_headers'), 'utf8');
  assert.doesNotMatch(html, /frame-ancestors/i);
  assert.match(headers, /frame-ancestors 'none'/i);
});

test('service worker refreshes navigations and config while caching only immutable assets', async () => {
  const worker = await readFile(path.join(root, 'site', 'sw.js'), 'utf8');
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /url\.pathname\.endsWith\('\/config\.js'\)/);
  assert.match(worker, /networkFirst/);
  assert.match(worker, /url\.pathname\.includes\('\/assets\/'\)/);
  assert.match(worker, /event\.waitUntil\([\s\S]*self\.clients\.claim\(\)/);
  assert.doesNotMatch(worker, /cached \|\| fetch\(request\)/);
});

test('service worker precaches the auth, responsive, and i18n shell under a new cache version', async () => {
  const worker = await readFile(path.join(root, 'site', 'sw.js'), 'utf8');
  assert.match(worker, /new Request\(asset, \{ cache: 'reload' \}\)/);
  assert.match(worker, /earth-radio-shell-v32-runtime-hash-2/);
  assert.doesNotMatch(worker, /earth-radio-shell-v31-runtime-hash-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v30-storage-generation-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v29-remediation-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v28-live-metadata-auth-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v27-live-metadata-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v27-supabase-auth-1\b/);
  assert.match(worker, /responsive-ui\.js/);
  assert.match(worker, /ui-refresh\.css/);
  assert.match(worker, /i18n\/zh-Hant\.js/);
  assert.match(worker, /i18n\/zh-Hans\.js/);
  assert.match(worker, /\.\/index\.html/);
  assert.match(worker, /networkFirst/);
});

test('service worker keeps the previous worker when reload precaching fails', async () => {
  const worker = await readFile(path.join(root, 'site', 'sw.js'), 'utf8');
  assert.doesNotMatch(worker, /\.catch\(\(\) => undefined\)/);
  assert.match(
    worker,
    /cache\.addAll\(shellRequests\)\)\s*\.then\(\(\) => self\.skipWaiting\(\)\)/
  );
  assert.equal((worker.match(/self\.skipWaiting\(\)/g) || []).length, 1);
});
