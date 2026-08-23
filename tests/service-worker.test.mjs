import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('service worker registers even when async startup outlives window load', async () => {
  const source = await readFile(path.join(root, 'src-recovered', 'main.ts'), 'utf8');
  const bundle = await readFile(path.join(root, 'site', 'assets', 'index-B4rKOAHV.js'), 'utf8');
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

test('service worker precaches the responsive shell and i18n catalogs under a new cache version', async () => {
  const worker = await readFile(path.join(root, 'site', 'sw.js'), 'utf8');
  assert.match(worker, /new Request\(asset, \{ cache: 'reload' \}\)/);
  assert.match(worker, /earth-radio-shell-v25-responsive-7/);
  assert.doesNotMatch(worker, /earth-radio-shell-v25-responsive-6/);
  assert.match(worker, /responsive-ui\.js/);
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
