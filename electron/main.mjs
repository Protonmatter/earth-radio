import { app, BrowserWindow, ipcMain, shell, session, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDesktopProxy } from '../server/desktop-proxy.mjs';
import { installDesktopProxyOrigin, parseNetworkProxyRule } from './proxy-rules.mjs';
import { AUTH_DEPLOYMENT } from '../site/assets/auth-deployment.js';
import { createAuthVault } from './auth-vault.mjs';
import { createDesktopAuthManager } from './auth-manager.mjs';
import { handleAuthIpc, isTrustedAuthSender } from './auth-ipc-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
let desktopProxy = null;
let mainWindow = null;
let networkProxyRules = '';
let authManager = null;
let authUnavailable = false;
const documentUrl = pathToFileURL(path.join(appRoot, 'site', 'index.html')).href;

function resolveAsset(...parts) {
  return path.join(appRoot, ...parts);
}

async function createMainWindow(proxyBaseUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    title: 'Earth Radio',
    icon: resolveAsset('site', 'branding', process.platform === 'win32' ? 'earth-radio-v2.ico' : 'earth-radio-512-v2.png'),
    backgroundColor: '#0a1020',
    show: false,
    webPreferences: {
      preload: resolveAsset('electron', 'preload.cjs'),
      additionalArguments: [`--earth-radio-proxy-base=${proxyBaseUrl}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', event => {
    event.preventDefault();
  });

  mainWindow.webContents.on('will-redirect', event => {
    event.preventDefault();
  });

  const expectedDocumentUrl = pathToFileURL(resolveAsset('site', 'index.html')).href;
  installDesktopProxyOrigin(mainWindow.webContents.session, { proxyBaseUrl,
    webContents: mainWindow.webContents, expectedDocumentUrl });

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src https: http: blob:; connect-src 'self' https: http: wss://listen.moe; font-src 'self'; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
        ]
      }
    });
  });

  await mainWindow.loadFile(resolveAsset('site', 'index.html'));
}

function registerIpc() {
  ipcMain.handle('earth-radio:auth', async (event, request) => {
    if (authUnavailable && isTrustedAuthSender(event, mainWindow?.webContents, documentUrl)) {
      return { ok: false, error: { message: 'Account storage could not be unlocked. Unlock your keychain and restart Earth Radio.', code: 'AUTH_UNAVAILABLE' } };
    }
    return handleAuthIpc({ event, request, webContents: mainWindow?.webContents, documentUrl, manager: authManager });
  });
  ipcMain.handle('earth-radio:get-network-proxy', async () => networkProxyRules);
  ipcMain.handle('earth-radio:set-network-proxy', async (_event, rawValue) => {
    const value = parseNetworkProxyRule(rawValue);
    // Apply first, record after: a rejected setProxy must not leave get-network-proxy
    // reporting a proxy that was never applied.
    if (!value || value.toLowerCase() === 'direct') {
      await session.defaultSession.setProxy({ mode: 'direct' });
      networkProxyRules = '';
      return '';
    }
    await session.defaultSession.setProxy({ proxyRules: value });
    networkProxyRules = value;
    return value;
  });
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault());
});

app.whenReady().then(async () => {
  try {
    const vault = await createAuthVault({ directory: path.join(app.getPath('userData'), 'auth-v1'), safeStorage });
    authManager = createDesktopAuthManager({ config: AUTH_DEPLOYMENT, vault, openExternal: url => shell.openExternal(url) });
    authManager.subscribe(payload => {
      const contents = mainWindow?.webContents;
      if (contents && isTrustedAuthSender({ sender: contents, senderFrame: contents.mainFrame }, contents, documentUrl)) {
        contents.send('earth-radio:auth-state', payload);
      }
    });
  } catch {
    // Never log keychain errors/session material or prevent local radio playback.
    authUnavailable = true;
  }
  registerIpc();
  desktopProxy = await createDesktopProxy({ port: Number(process.env.EARTH_RADIO_PROXY_PORT || 0) });
  await createMainWindow(desktopProxy.baseUrl);

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow(desktopProxy.baseUrl);
    }
  });
}).catch(error => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  try { await authManager?.close(); } catch { /* best effort, ciphertext is atomic */ }
  try { await desktopProxy?.close?.(); } catch { /* best effort */ }
});
