// Run with Electron, not node:test. Real sandboxed file renderer and production
// proxy, isolated profile, no station/audio/provider request or credential output.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createDesktopProxy } from '../server/desktop-proxy.mjs';
import { installDesktopProxyOrigin } from '../electron/proxy-rules.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, '.build', 'desktop-renderer');
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
const watchdog = setTimeout(() => { console.error('Desktop renderer smoke timed out'); app.exit(2); }, 25000);

app.whenReady().then(async () => {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'fixture.html');
  await writeFile(file, '<!doctype html><title>Desktop Origin regression</title><p>Isolated renderer</p>');
  const proxy = await createDesktopProxy({ port: 0 });
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true,
    nodeIntegration: false, preload: path.join(root, 'electron', 'preload.cjs'),
    additionalArguments: [`--earth-radio-proxy-base=${proxy.baseUrl}`] } });
  try {
    await window.loadFile(file);
    const probe = "fetch(window.earthRadio.proxyBaseUrl + '/api/track/fingerprint').then(response => response.status)";
    const before = await window.webContents.executeJavaScript(probe);
    assert.equal(before, 403, 'Missing file Origin must remain rejected by the production proxy');
    installDesktopProxyOrigin(window.webContents.session, { proxyBaseUrl: proxy.baseUrl,
      webContents: window.webContents, expectedDocumentUrl: pathToFileURL(file).href });
    const after = await window.webContents.executeJavaScript(probe);
    assert.equal(after, 200, 'The owned file renderer should reach its capability API');
    const raw = await fetch(`${proxy.baseUrl}/api/track/fingerprint`);
    assert.equal(raw.status, 403, 'Raw originless clients must remain rejected');
    console.log(JSON.stringify({ missingOriginRejected: before === 403, ownedRendererAccepted: after === 200,
      rawClientStillRejected: raw.status === 403, sandbox: true, contextIsolation: true }));
  } finally {
    window.destroy(); proxy.server.closeAllConnections(); await proxy.close(); clearTimeout(watchdog);
  }
  app.exit(0);
}).catch(error => { console.error(error.name, error.message); clearTimeout(watchdog); app.exit(1); });
