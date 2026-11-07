import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';

const root = path.resolve(import.meta.dirname, '..');
await mkdir(path.join(root, '.build'), { recursive: true });
const directory = await mkdtemp(path.join(root, '.build', 'native-lifecycle-'));
app.setPath('userData', path.join(directory, 'controller'));
app.disableHardwareAcceleration();
const children = [];
const watchdog = setTimeout(() => { for (const child of children) child.kill(); app.exit(2); }, 30000);

function launch(mode) {
  const child = spawn(process.execPath, [path.join(root, 'tests', 'fixtures', 'desktop-auth-lifecycle.mjs'), mode], {
    env: { ...process.env, EARTH_RADIO_QUALIFICATION_PROFILE: path.join(directory, 'shared-profile') },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true
  });
  children.push(child);
  const messages = [];
  child.on('message', value => messages.push(value));
  const closed = new Promise(resolve => child.once('close', resolve));
  const message = kind => new Promise((resolve, reject) => {
    const found = messages.find(value => value.kind === kind);
    if (found) { resolve(found); return; }
    const timer = setTimeout(() => { child.removeListener('message', onMessage); reject(new Error(`Lifecycle fixture did not report ${kind}.`)); }, 10000);
    function onMessage(value) {
      if (value.kind === kind) { clearTimeout(timer); child.removeListener('message', onMessage); resolve(value); }
      if (value.kind === 'failure') { clearTimeout(timer); child.removeListener('message', onMessage); reject(new Error('Lifecycle fixture failed.')); }
    }
    child.on('message', onMessage);
  });
  return { child, closed, message };
}

app.whenReady().then(async () => {
  for (const logout of [false, true]) {
  const first = launch(logout ? 'hold-logout' : 'hold');
  await first.message('ready');
  const second = launch('second');
  await second.message('blocked');
  assert.equal(await second.closed, 0, 'Second instance should exit without session ownership.');
  first.child.send('quit');
  await first.message('quit-held');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(first.child.exitCode, null, 'Normal quit must wait for the held encrypted write.');
  first.child.send('release');
  assert.equal(await first.closed, 0);
  const restart = launch(logout ? 'verify-logout' : 'verify');
  assert.equal((await restart.message('verified')).restored, true, 'Restart must see the completed update.');
  assert.equal(await restart.closed, 0);
  }
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, singleProfileOwner: true,
    normalQuitWaitsForVault: true, encryptedUpdateRestoredAfterQuit: true, logoutDeletionSurvivesQuit: true }));
  clearTimeout(watchdog);
  await rm(directory, { recursive: true, force: true });
  app.exit(0);
}).catch(error => {
  for (const child of children) if (child.exitCode === null) child.kill();
  console.error('Native lifecycle qualification failed:', error.message);
  clearTimeout(watchdog); app.exit(1);
});
