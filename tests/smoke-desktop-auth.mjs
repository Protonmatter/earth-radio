// Native Electron qualification: actual sandbox/preload, main IPC, ephemeral
// loopback PKCE and OS encryption. Provider HTTP responses are synthetic here;
// real GoTrue/RLS and live external providers are separate qualification gates.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rename, rmdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { createAuthVault } from '../electron/auth-vault.mjs';
import { createDesktopAuthManager } from '../electron/auth-manager.mjs';
import { handleAuthIpc, isTrustedAuthSender, installAuthNavigationPolicy } from '../electron/auth-ipc-policy.mjs';

const root = path.resolve(import.meta.dirname, '..');
await mkdir(path.join(root, '.build'), { recursive: true });
const directory = await mkdtemp(path.join(root, '.build', 'native-auth-'));
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
const watchdog = setTimeout(() => { console.error('Native auth qualification timed out.'); app.exit(2); }, 30000);
let window, manager;
let qualificationPhase = 'isolated fixture';

app.whenReady().then(async () => {
  const fixture = path.join(directory, 'auth.html');
  await writeFile(fixture, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; frame-src \'self\'"><title>Earth Radio isolated authentication qualification</title><p>Isolated account test</p><iframe src="frame.html"></iframe>');
  await writeFile(path.join(directory, 'frame.html'), '<!doctype html><p>Untrusted child frame</p>');
  let documentUrl = pathToFileURL(fixture).href;
  const vaultDirectory = path.join(directory, 'credentials');
  const config = { url: 'https://earth-radio-qualification.supabase.co', publishableKey: 'sb_publishable_qualification' };
  let authorize;
  const records = new Map();
  const session = { access_token: 'qualification-private-access', refresh_token: 'qualification-private-refresh', expires_in: 3600,
    user: { id: 'qualification-user', email: 'qualification@earth-radio.test', identities: [{ provider: 'google' }] } };
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  function create(vault) {
    return createDesktopAuthManager({ config, vault, openExternal: async value => { authorize = new URL(value); },
      fetchImpl: async (value, init) => {
        const url = new URL(value);
        if (url.pathname.endsWith('/token')) {
          const body = JSON.parse(init.body);
          assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), authorize.searchParams.get('code_challenge'));
          return json(session);
        }
        if (url.pathname.endsWith('/user')) return json(session.user);
        if (url.pathname.endsWith('/settings')) return json({ external: { google: true, github: true, email: true } });
        if (url.pathname.endsWith('/logout')) return json({});
        if (url.pathname.endsWith('/user_config_documents')) return json([...records.values()]);
        if (url.pathname.endsWith('/rpc/upsert_user_config_document')) {
          const b = JSON.parse(init.body);
          const row = { document_key: b.p_document_key, value: b.p_value, revision: 1, deleted_at: null };
          records.set(row.document_key, row);
          return json([row]);
        }
        throw new Error('Unexpected qualification endpoint.');
      } });
  }
  function subscribe() {
    manager.subscribe(payload => {
      const contents = window?.webContents;
      if (contents && isTrustedAuthSender({ sender: contents, senderFrame: contents.mainFrame }, contents, documentUrl)) {
        contents.send('earth-radio:auth-state', payload);
      }
    });
  }
  manager = create(await createAuthVault({ directory: vaultDirectory, safeStorage }));
  ipcMain.handle('earth-radio:auth', (event, request) => handleAuthIpc({ event, request,
    webContents: window && !window.isDestroyed() ? window.webContents : null, documentUrl, manager }));
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
    preload: path.join(root, 'electron', 'preload.cjs') } });
  subscribe();
  await window.loadFile(fixture);
  const adapter = pathToFileURL(path.join(root, 'site', 'assets', 'desktop-auth.js')).href;
  const nativeAvailable = await window.webContents.executeJavaScript(`import(${JSON.stringify(adapter)}).then(module => {
    window.qualificationAuth = module.createDesktopAuthClient(window.earthRadio.auth);
    window.qualificationEvents = [];
    window.qualificationAuth.onAuthStateChange((event, session) => window.qualificationEvents.push({event, session}));
    return module.isDesktopAuthAvailable(window.earthRadio, window.location);
  })`);
  assert.equal(nativeAvailable, true, 'The actual file document must select native authentication.');
  assert.equal(await window.webContents.executeJavaScript('typeof require'), 'undefined');
  assert.equal(await window.webContents.executeJavaScript('typeof process'), 'undefined');
  const frames = window.webContents.mainFrame.frames;
  assert.equal(frames.length, 1);
  assert.equal(await frames[0].executeJavaScript("window.earthRadio ? window.earthRadio.auth.invoke('session').then(value => value.ok) : false"), false, 'Child frames must have no account access.');
  await window.webContents.executeJavaScript("window.qualificationAuth.signInWithOAuth('google')");
  const callback = authorize.searchParams.get('redirect_to');
  assert.equal((await fetch(`${callback}?code=qualification-code`)).status, 200);
  const display = await window.webContents.executeJavaScript('window.qualificationAuth.getSession()');
  assert.equal(display.user.id, 'qualification-user');
  const eventText = await window.webContents.executeJavaScript('JSON.stringify(window.qualificationEvents)');
  assert.equal(JSON.parse(eventText).some(value => value.event === 'SIGNED_IN'), true, 'The renderer must receive the successful sign-in event.');
  assert.doesNotMatch(JSON.stringify(display) + eventText, /qualification-private|access_token|refresh_token|code_verifier/);
  const ciphertext = await readFile(path.join(vaultDirectory, 'session.enc'));
  assert.equal(ciphertext.includes(Buffer.from('qualification-private')), false);
  const body = { p_document_key: 'favorites', p_value: { station: { uuid: 'station', addedAt: '2026-01-01T00:00:00Z' } }, p_expected_revision: 0, p_delete: false };
  await window.webContents.executeJavaScript(`window.qualificationAuth.rpc('upsert_user_config_document', ${JSON.stringify(body)}, {expectedUserId:'qualification-user'})`);
  await manager.close();
  manager = create(await createAuthVault({ directory: vaultDirectory, safeStorage }));
  subscribe();
  assert.equal((await window.webContents.executeJavaScript('window.qualificationAuth.initialize()')).user.id, 'qualification-user');
  const downloaded = await window.webContents.executeJavaScript("window.qualificationAuth.rest('user_config_documents?select=document_key,value,revision,deleted_at&order=document_key', {expectedUserId:'qualification-user'})");
  assert.equal(downloaded[0].value.station.uuid, 'station');
  await window.webContents.executeJavaScript('window.qualificationAuth.signOut()');
  await manager.close();
  manager = create(await createAuthVault({ directory: vaultDirectory, safeStorage }));
  assert.equal((await window.webContents.executeJavaScript('window.qualificationAuth.initialize()')), null);
  // Exercise the real account UI rather than only the bridge contract. Native
  // sign-in completes without leaving the renderer, so its account transition
  // must be able to reload the exact trusted document and start synchronization.
  documentUrl = pathToFileURL(path.join(root, 'site', 'index.html')).href;
  qualificationPhase = 'real account UI';
  records.set('preferences', { document_key: 'preferences', value: { volume: 0.41 }, revision: 1, deleted_at: null });
  installAuthNavigationPolicy(window.webContents, documentUrl);
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  subscribe();
  await window.loadURL(documentUrl);
  let uiStage = 0;
  async function until(script) {
    uiStage++;
    let matched = false;
    for (let i = 0; i < 500; i++) {
      if (window.webContents.isLoadingMainFrame()) { matched = false; await new Promise(resolve => setTimeout(resolve, 20)); continue; }
      let current = false;
      try { current = Boolean(await window.webContents.executeJavaScript(script)); } catch { /* document may be reloading */ }
      if (current && matched) return;
      matched = current;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail(`The real native account UI did not reach expected stage ${uiStage}.`);
  }
  async function openAccount() {
    await until("Boolean(document.getElementById('er-auth-button'))");
    for (let i = 0; i < 50; i++) {
      try {
        await window.webContents.executeJavaScript("document.getElementById('er-auth-button')?.click()");
        if (await window.webContents.executeJavaScript("document.querySelector('.er-auth-modal')?.hidden === false")) return;
      } catch { /* a namespace reload can replace the document after the first read */ }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('The real native account dialog did not open.');
  }
  await until("document.getElementById('er-auth-button')?.textContent === 'Sign in'");
  assert.equal(await window.webContents.executeJavaScript('document.documentElement.dataset.appVersion'),
    JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, 'The visible runtime version must match the desktop package.');
  await openAccount();
  await until("Array.from(document.querySelectorAll('.er-auth-provider')).some(button=>button.textContent==='Continue with Google')");
  authorize = null;
  await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.er-auth-provider')).find(button=>button.textContent==='Continue with Google').click()");
  // Wait for the external-browser PKCE request to be emitted by main.
  for (let i = 0; i < 100; i++) { if (authorize) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.ok(authorize, 'Native UI must start the main-owned browser flow.');
  assert.equal((await fetch(`${authorize.searchParams.get('redirect_to')}?code=ui-qualification-code`)).status, 200);
  await until("document.getElementById('er-auth-button')?.textContent === 'qualification@earth-radio.test'");
  await openAccount();
  await until("document.querySelector('.er-auth-modal')?.textContent.includes('Synced')");
  await until("Math.abs(Number(document.getElementById('volume')?.value)-0.41)<0.001");
  await until("document.getElementById('er-auth-button')?.textContent === 'qualification@earth-radio.test'");
  await openAccount();
  records.set('preferences', { document_key: 'preferences', value: { volume: 0.42 }, revision: 2, deleted_at: null });
  await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.er-auth-secondary')).find(button=>button.textContent==='Sync now').click()");
  await until("Math.abs(Number(document.getElementById('volume')?.value)-0.42)<0.001");
  await until("document.getElementById('er-auth-button')?.textContent === 'qualification@earth-radio.test'");
  await openAccount();
  qualificationPhase = 'UI sign-out persistence failure';
  // Force a real filesystem deletion failure in this disposable profile. The
  // encrypted session remains recoverable until sign-out can be retried.
  const credentialFile = path.join(vaultDirectory, 'session.enc');
  const credentialBackup = path.join(vaultDirectory, 'session.backup');
  await rename(credentialFile, credentialBackup);
  await mkdir(credentialFile);
  try {
    await window.webContents.executeJavaScript(`window.qualificationUnhandled = 0;
      window.addEventListener('unhandledrejection', () => { window.qualificationUnhandled++; });
      Array.from(document.querySelectorAll('.er-auth-secondary')).find(button=>button.textContent==='Sign out').click()`);
    await until("document.querySelector('.er-auth-sync')?.textContent === 'Sign-out incomplete · sync paused'");
    assert.equal(await window.webContents.executeJavaScript('window.qualificationUnhandled'), 0, 'Sign-out failure must be handled in the account UI.');
    assert.equal(await window.webContents.executeJavaScript("localStorage.getItem('earthRadio.auth.activeUser.v1')"), 'qualification-user', 'Do not detach the namespace until credential deletion succeeds.');
    assert.equal(await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.er-auth-secondary')).find(button=>button.textContent==='Sign out').disabled"), false, 'A failed sign-out must remain retryable.');
    await window.webContents.executeJavaScript("window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange'));");
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('.er-auth-sync')?.textContent"), 'Sign-out incomplete · sync paused', 'Background events must not resume sync with an uncertain session.');
  } finally {
    await rmdir(credentialFile);
    await rename(credentialBackup, credentialFile);
  }
  qualificationPhase = 'UI account switch';
  await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.er-auth-secondary')).find(button=>button.textContent==='Sign out').click()")
    .catch(async () => until("document.getElementById('er-auth-button')?.textContent === 'Sign in'"));
  await until("document.getElementById('er-auth-button')?.textContent === 'Sign in'");
  session.user = { id: 'qualification-second-user', email: 'second@earth-radio.test', identities: [{ provider: 'github' }] };
  await openAccount();
  await until("Array.from(document.querySelectorAll('.er-auth-provider')).some(button=>button.textContent==='Continue with GitHub')");
  authorize = null;
  await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.er-auth-provider')).find(button=>button.textContent==='Continue with GitHub').click()");
  for (let i = 0; i < 100; i++) { if (authorize) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.ok(authorize);
  assert.equal((await fetch(`${authorize.searchParams.get('redirect_to')}?code=second-ui-code`)).status, 200);
  await until("document.getElementById('er-auth-button')?.textContent === 'second@earth-radio.test'");
  await openAccount();
  await until("document.querySelector('.er-auth-modal')?.textContent.includes('Synced')");
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, sandbox: true, contextIsolation: true,
    ownedFrameOnly: true, pkceLoopback: true, tokenFreeRenderer: true, osEncryptedRestart: true,
    syncAdapterRoundTrip: true, logoutSurvivesRestart: true, actualAccountUiSync: true, signOutFailureRecovery: true,
    providerEvidence: 'synthetic HTTP, separate from live qualification' }));
}).then(async () => {
  await manager?.close(); window?.destroy(); clearTimeout(watchdog);
  await rm(directory, { recursive: true, force: true });
  app.exit(0);
}).catch(async error => {
  console.error('Native auth qualification failed:', qualificationPhase, error?.name || typeof error, error?.message || String(error));
  await manager?.close().catch(() => {}); window?.destroy(); clearTimeout(watchdog); app.exit(1);
});
