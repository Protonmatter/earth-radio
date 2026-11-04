import path from 'node:path';
import { app, safeStorage } from 'electron';
import { claimDesktopInstance, createQuitGate } from '../../electron/auth-lifecycle.mjs';
import { createAuthVault } from '../../electron/auth-vault.mjs';
import { authStorageKeys } from '../../site/assets/auth-core.js';

const profile = process.env.EARTH_RADIO_QUALIFICATION_PROFILE;
const mode = process.argv.at(-1);
if (!profile || !path.isAbsolute(profile) || !['hold', 'hold-logout', 'second', 'verify', 'verify-logout'].includes(mode)) app.exit(2);
app.setName('EarthRadioLifecycleQualification');
app.setPath('userData', profile);
app.disableHardwareAcceleration();
const primary = claimDesktopInstance(app, () => process.send?.({ kind: 'second-launch-observed' }));
if (!primary) process.send?.({ kind: 'blocked' });
else app.whenReady().then(async () => {
  let release, hold = false;
  const gate = new Promise(resolve => { release = resolve; });
  const vault = await createAuthVault({ directory: path.join(profile, 'auth-v1'), safeStorage: {
    isAsyncEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    decryptStringAsync: value => safeStorage.decryptStringAsync(value),
    async encryptStringAsync(value) { if (hold) await gate; return safeStorage.encryptStringAsync(value); }
  } });
  if (mode.startsWith('verify')) {
    process.send?.({ kind: 'verified', restored: vault.storage.getItem(authStorageKeys.session) === (mode === 'verify-logout' ? null : 'updated-session') });
    app.quit(); return;
  }
  if (!mode.startsWith('hold')) throw new Error('Secondary process unexpectedly acquired session ownership.');
  vault.storage.setItem(authStorageKeys.session, 'old-session');
  await vault.flush();
  hold = true;
  vault.storage.setItem(authStorageKeys.session, 'updated-session');
  if (mode === 'hold-logout') vault.storage.removeItem(authStorageKeys.session);
  const quitGate = createQuitGate({ finish: () => vault.flush(), quit: () => app.quit(),
    onFailure: () => { process.send?.({ kind: 'failure' }); app.exit(1); } });
  app.on('before-quit', event => { quitGate(event); if (event.defaultPrevented) process.send?.({ kind: 'quit-held' }); });
  process.on('message', message => {
    if (message === 'quit') app.quit();
    if (message === 'release') release();
  });
  process.send?.({ kind: 'ready' });
}).catch(() => { process.send?.({ kind: 'failure' }); app.exit(1); });
