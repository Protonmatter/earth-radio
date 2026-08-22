import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopProxy } from '../server/desktop-proxy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'electron/main.mjs',
  'electron/preload.cjs',
  'server/desktop-proxy.mjs',
  'electron-builder.yml',
  'site/config.js',
  'docs/recovered/DESKTOP_REBUILD_AND_SIGNING.md'
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}

const config = fs.readFileSync(path.join(root, 'site/config.js'), 'utf8');
if (!config.includes('desktopProxyBaseUrl')) throw new Error('site/config.js does not consume desktop proxy base URL');
if (!config.includes('proxyBaseUrl: desktopProxyBaseUrl')) throw new Error('desktop proxy is not wired into runtime config');

const main = fs.readFileSync(path.join(root, 'electron/main.mjs'), 'utf8');
for (const invariant of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'setWindowOpenHandler', 'will-navigate']) {
  if (!main.includes(invariant)) throw new Error(`Electron main missing invariant: ${invariant}`);
}
if (!main.includes("resolveAsset('site', 'index.html')") || main.includes("resolveAsset('dist', 'index.html')")) {
  throw new Error('Electron main does not load the recovered site directory');
}

const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
if (!builder.includes('  - site/**') || builder.includes('  - dist/**')) {
  throw new Error('electron-builder does not package the recovered site directory');
}

const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageMetadata.main !== 'electron/main.mjs') throw new Error('package.json does not declare the Electron entry point');
if (!packageMetadata.scripts?.['pack:desktop'] || !packageMetadata.scripts?.['dist:desktop']) {
  throw new Error('package.json does not expose desktop packaging commands');
}

const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
if (!preload.includes('contextBridge.exposeInMainWorld')) throw new Error('preload does not expose a constrained contextBridge API');
if (!preload.includes('proxyBaseUrl')) throw new Error('preload does not expose proxyBaseUrl');

const server = fs.readFileSync(path.join(root, 'server/desktop-proxy.mjs'), 'utf8');
for (const route of ['/api/stations/federated', '/api/streams/probe', '/api/streams/resolve', '/api/streams/nowplaying']) {
  if (!server.includes(route)) throw new Error(`desktop proxy missing route ${route}`);
}
if (!server.includes('assertPublicUrl')) throw new Error('desktop proxy lacks stream URL guard');

const proxy = await createDesktopProxy({ port: 0 });
try {
  const response = await fetch(`${proxy.baseUrl}/healthz`, { headers: { Origin: 'null' } });
  const payload = await response.json();
  if (!payload.ok || payload.service !== 'earth-radio-desktop-proxy') throw new Error('desktop proxy healthz failed');

  const unauthenticatedBaseUrl = new URL(proxy.baseUrl).origin;
  const unauthenticated = await fetch(`${unauthenticatedBaseUrl}/healthz`, { headers: { Origin: 'null' } });
  if (unauthenticated.status !== 404) throw new Error(`desktop proxy exposed an unauthenticated route: ${unauthenticated.status}`);

  const missingOrigin = await fetch(`${proxy.baseUrl}/api/stations/top?limit=50`);
  if (missingOrigin.status !== 403) throw new Error(`desktop proxy accepted an API request without Origin: ${missingOrigin.status}`);

  const nullOrigin = await fetch(`${proxy.baseUrl}/healthz`, { headers: { Origin: 'null' } });
  if (nullOrigin.status !== 200 || nullOrigin.headers.get('access-control-allow-origin') !== 'null') {
    throw new Error('desktop proxy did not preserve authenticated Electron file-origin access');
  }

  const crossOrigin = await fetch(`${proxy.baseUrl}/healthz`, { headers: { Origin: 'https://evil.example' } });
  if (crossOrigin.status !== 403) throw new Error(`desktop proxy accepted an untrusted Origin: ${crossOrigin.status}`);

  const requestOptions = { headers: { Origin: 'null' } };
  const blocked = await fetch(`${proxy.baseUrl}/api/streams/probe?url=${encodeURIComponent('http://127.0.0.1:1/test.mp3')}`, requestOptions);
  const blockedPayload = await blocked.json();
  if (blocked.status !== 400 || !/private/i.test(blockedPayload.error || '')) {
    throw new Error('desktop proxy did not reject private stream URL');
  }

  const blockedV6 = await fetch(`${proxy.baseUrl}/api/streams/probe?url=${encodeURIComponent('http://[::1]:1/test.mp3')}`, requestOptions);
  const blockedV6Payload = await blockedV6.json();
  if (blockedV6.status !== 400 || !/private/i.test(blockedV6Payload.error || '')) {
    throw new Error('desktop proxy did not reject IPv6 loopback stream URL');
  }

  for (const target of [
    'http://[::ffff:127.0.0.1]:1/test.mp3',
    'http://[::ffff:169.254.169.254]/latest/meta-data',
    'http://[::ffff:10.0.0.1]/test.mp3',
    'http://100.64.0.1/test.mp3'
  ]) {
    const mapped = await fetch(`${proxy.baseUrl}/api/streams/probe?url=${encodeURIComponent(target)}`, requestOptions);
    const mappedPayload = await mapped.json();
    if (mapped.status !== 400 || !/private/i.test(mappedPayload.error || '')) {
      throw new Error(`desktop proxy did not reject private stream representation: ${target}`);
    }
  }
} finally {
  await proxy.close();
}

console.log('desktop smoke checks passed');
