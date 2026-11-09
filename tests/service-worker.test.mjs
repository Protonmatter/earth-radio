import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { versionSiteModules } from '../scripts/version-site-modules.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('release module URLs are coherent and an older cache cannot satisfy a newer import', async () => {
  await versionSiteModules(root, { check: true });
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const worker = await readFile(path.join(root, 'site/sw.js'), 'utf8');
  for (const asset of ['song-library-core.js', 'song-library-store.js', 'song-library-ui.js', 'metadata-enrichment.js']) {
    assert.ok(worker.includes(`./assets/${asset}?v=${version}`));
  }
  const handlers = new Map(); let fetched = '';
  vm.runInNewContext(worker, {
    self: { location: { origin: 'https://radio.example' }, addEventListener: (name, handler) => handlers.set(name, handler) },
    URL, Request, Response,
    fetch: async request => { fetched = request.url; return new Response('new module'); },
    caches: { match: async request => request.url.endsWith('?v=0.28.0') ? new Response('old module') : undefined,
      open: async () => ({ put: async () => {} }) }
  });
  let response;
  const url = `https://radio.example/assets/metadata-enrichment.js?v=${version}`;
  handlers.get('fetch')({ request: new Request(url), respondWith: promise => { response = promise; } });
  assert.equal(await (await response).text(), 'new module'); assert.equal(fetched, url);
});

for (const relative of ['/branding/earth-radio-192-v2.png', '/manifest.webmanifest']) {
  test(`service worker serves cached ${relative} when the network is offline`, async () => {
    const worker = await readFile(path.join(root, 'site', 'sw.js'), 'utf8');
    const handlers = new Map();
    const cached = new Response('cached-shell-resource', { headers: { 'Content-Type': relative.endsWith('.png') ? 'image/png' : 'application/manifest+json' } });
    vm.runInNewContext(worker, {
      self: { location: { origin: 'https://radio.example' }, addEventListener: (name, handler) => handlers.set(name, handler) },
      URL, Request, Response,
      fetch: async () => { throw new Error('offline'); },
      caches: { match: async request => request.url === `https://radio.example${relative}` ? cached : undefined }
    });
    let response;
    handlers.get('fetch')({ request: new Request(`https://radio.example${relative}`), respondWith: promise => { response = promise; } });
    assert.ok(response, 'The shell request must be handled by the service worker');
    assert.equal(await (await response).text(), 'cached-shell-resource');
  });
}

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
  const bundle = await readFile(path.join(root, 'site', 'assets', 'index-7562b0d8.js'), 'utf8');
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

test('deployed pages send HSTS and revalidate the auth overlays', async () => {
  const headers = await readFile(path.join(root, 'site', '_headers'), 'utf8');
  assert.match(headers, /Strict-Transport-Security: max-age=31536000; includeSubDomains; preload/);
  for (const asset of ['auth-core.js', 'sync-core.js', 'auth-ui.js', 'auth-ui.css']) {
    assert.match(
      headers,
      new RegExp(`/assets/${asset}\\n\\s+Cache-Control: public, max-age=300, must-revalidate`)
    );
  }
});

test('service worker precaches the auth, responsive, and i18n shell under a new cache version', async () => {
  const worker = await readFile(path.join(root, 'site', 'sw.js'), 'utf8');
  assert.match(worker, /cache: isImmutableAsset\(asset\) \? 'force-cache' : 'reload'/);
  assert.match(worker, /earth-radio-shell-v66-normalized-directory/);
  for (const size of [32, 180, 192, 512]) assert.ok(worker.includes(`branding/earth-radio-${size}-v2.png`));
  for (const asset of ['discovery-core.js', 'discovery-ui.js', 'map-directory.js', 'discovery.css', 'listening-room.css', 'vector-atlas.js', 'world-land.js']) {
    assert.ok(worker.includes(`./assets/${asset}`), `Missing discovery shell asset ${asset}`);
  }
  assert.doesNotMatch(worker, /earth-radio-shell-v45-review-auth-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v44-visible-signin-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v43-auth-unfreeze-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v42-auth-review-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v41-auth-exact-redirect-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v40-pkce-callback-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v39-review-p2-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v36-review-closure-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v35-listen-moe-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v33-tooltip-waf-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v32-runtime-hash-2\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v31-runtime-hash-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v30-storage-generation-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v29-remediation-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v28-live-metadata-auth-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v27-live-metadata-1\b/);
  assert.doesNotMatch(worker, /earth-radio-shell-v27-supabase-auth-1\b/);
  assert.match(worker, /pinned-stations\.js/);
  assert.match(worker, /responsive-ui\.js/);
  assert.match(worker, /ui-refresh\.css/);
  assert.match(worker, /atlas-lock\.css/);
  assert.match(worker, /atlas-lock\.js/);
  assert.match(worker, /i18n\/zh-Hant\.js/);
  assert.match(worker, /i18n\/zh-Hans\.js/);
  assert.doesNotMatch(worker, /['"]\.\/index\.html['"]/);
  assert.match(worker, /networkFirst/);
});

test('large map modules are lazy and offline navigation uses the canonical root shell',async()=>{
  const worker=await readFile(path.join(root,'site/sw.js'),'utf8');
  const precache=worker.slice(0,worker.indexOf("self.addEventListener('install'"));
  assert.doesNotMatch(precache,/map-(?:world|detail|terrain|roads)/);
  const handlers=new Map();let used;
  vm.runInNewContext(worker,{self:{location:{origin:'https://radio.example'},addEventListener:(name,handler)=>handlers.set(name,handler)},URL,Request,Response,
    fetch:async()=>{throw Error('offline');},caches:{match:async key=>{if(key==='./'){used=key;return new Response('offline canonical shell');}return undefined;}}});
  let result;handlers.get('fetch')({request:{method:'GET',url:'https://radio.example/some-navigation',mode:'navigate'},respondWith:promise=>{result=promise;}});
  assert.equal(await (await result).text(),'offline canonical shell');assert.equal(used,'./');
});

test('installation shell stays below two MiB while map detail remains opt-in',async()=>{
  const worker=await readFile(path.join(root,'site/sw.js'),'utf8');
  const assets=vm.runInNewContext(worker.match(/const SHELL_ASSETS = (\[[\s\S]*?\]);/)[1]);
  let bytes=0;for(const asset of assets){const relative=asset==='./'?'index.html':asset.replace(/^\.\//,'').split('?')[0];bytes+=(await readFile(path.join(root,'site',relative))).length;}
  assert.ok(bytes<2*1024*1024,`Shell is ${bytes} bytes`);
});

for(const offline of [false,true])test(`sign-in query navigations are never persisted${offline?' while offline':''}`,async()=>{
  const worker=await readFile(path.join(root,'site/sw.js'),'utf8'),handlers=new Map(),writes=[],reads=[];
  vm.runInNewContext(worker,{self:{location:{origin:'https://radio.example'},addEventListener:(name,handler)=>handlers.set(name,handler)},URL,Request,Response,
    fetch:async()=>{if(offline)throw Error('offline');return new Response('network shell');},
    caches:{open:async()=>({put:async request=>writes.push(request.url)}),match:async request=>{reads.push(request);return request==='./'?new Response('canonical shell'):undefined;}}});
  let result;handlers.get('fetch')({request:{method:'GET',mode:'navigate',url:'https://radio.example/?code=fixture-only'},respondWith:promise=>{result=promise;}});
  assert.equal(await(await result).text(),offline?'canonical shell':'network shell');assert.equal(writes.length,0);assert.ok(reads.every(request=>request==='./'));
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

test('enforced connect-src policies admit the Listen.moe realtime gateway', async () => {
  // The metadata overlay's only Listen.moe feed is wss://listen.moe/…/gateway_v2.
  // Meta, _headers, and Electron all apply; the intersection must still allow that
  // host. CSP3 treats connect-src ws: as ws: wss:, but the host token is what the
  // header/Electron policies actually name, so every policy lists it explicitly.
  const html = await readFile(path.join(root, 'site', 'index.html'), 'utf8');
  const headers = await readFile(path.join(root, 'site', '_headers'), 'utf8');
  const electronMain = await readFile(path.join(root, 'electron', 'main.mjs'), 'utf8');
  const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1] || '';
  for (const policy of [meta, headers, electronMain]) {
    const connect = policy.match(/connect-src ([^;]+)/)?.[1] || '';
    assert.match(connect, /wss:\/\/listen\.moe/);
  }
});
