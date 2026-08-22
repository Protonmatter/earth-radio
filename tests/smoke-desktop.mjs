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
  'dist/config.js',
  'docs/DESKTOP_REBUILD_AND_SIGNING.md'
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}

const config = fs.readFileSync(path.join(root, 'dist/config.js'), 'utf8');
if (!config.includes('desktopProxyBaseUrl')) throw new Error('dist/config.js does not consume desktop proxy base URL');
if (!config.includes('proxyBaseUrl: desktopProxyBaseUrl')) throw new Error('desktop proxy is not wired into runtime config');

const main = fs.readFileSync(path.join(root, 'electron/main.mjs'), 'utf8');
for (const invariant of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'setWindowOpenHandler', 'will-navigate']) {
  if (!main.includes(invariant)) throw new Error(`Electron main missing invariant: ${invariant}`);
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
  const response = await fetch(`${proxy.baseUrl}/healthz`);
  const payload = await response.json();
  if (!payload.ok || payload.service !== 'earth-radio-desktop-proxy') throw new Error('desktop proxy healthz failed');

  const blocked = await fetch(`${proxy.baseUrl}/api/streams/probe?url=${encodeURIComponent('http://127.0.0.1:1/test.mp3')}`);
  const blockedPayload = await blocked.json();
  if (blocked.status !== 400 || !/private/i.test(blockedPayload.error || '')) {
    throw new Error('desktop proxy did not reject private stream URL');
  }
} finally {
  await proxy.close();
}

console.log('desktop smoke checks passed');
