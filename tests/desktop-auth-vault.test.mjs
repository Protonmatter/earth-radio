import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createAuthVault } from '../electron/auth-vault.mjs';
import { authStorageKeys } from '../site/assets/auth-core.js';

// OS encryption is exercised separately in native Electron. Use real authenticated
// encryption here to catch plaintext writes, corruption and update ordering.
function encryption() {
  const key = randomBytes(32);
  return {
    isAsyncEncryptionAvailable: async () => true,
    async encryptStringAsync(value) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
      return Buffer.concat([nonce, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    async decryptStringAsync(value) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12), { authTagLength: 16 });
      cipher.setAuthTag(value.subarray(-16));
      return { result: Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString('utf8'), shouldReEncrypt: false };
    }
  };
}

async function fixture(t, safeStorage = encryption()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-vault-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, safeStorage, vault: await createAuthVault({ directory, safeStorage }) };
}

test('vault persists ciphertext only, keeps verifier in memory, and restores the session', async t => {
  const { vault, directory, safeStorage } = await fixture(t);
  const value = JSON.stringify({ access_token: 'sensitive-access', refresh_token: 'sensitive-refresh' });
  vault.storage.setItem(authStorageKeys.session, value);
  vault.storage.setItem(authStorageKeys.pkce, 'sensitive-verifier');
  await vault.flush();
  const files = await readdir(directory);
  assert.deepEqual(files, ['session.enc']);
  const disk = await readFile(path.join(directory, files[0]));
  for (const secret of ['sensitive-access', 'sensitive-refresh', 'sensitive-verifier']) assert.equal(disk.includes(Buffer.from(secret)), false);
  const restored = await createAuthVault({ directory, safeStorage });
  assert.equal(restored.storage.getItem(authStorageKeys.session), value);
  assert.equal(restored.storage.getItem(authStorageKeys.pkce), null);
  vault.storage.setItem(authStorageKeys.session, 'replacement');
  vault.storage.removeItem(authStorageKeys.session);
  await vault.flush();
  assert.deepEqual(await readdir(directory), []);
});

test('vault refuses unavailable encryption and corrupt ciphertext without overwriting it', async t => {
  const { directory, safeStorage } = await fixture(t);
  await assert.rejects(createAuthVault({ directory, safeStorage: { isAsyncEncryptionAvailable: async () => false } }), /encryption/i);
  const corrupt = Buffer.from('not ciphertext');
  await writeFile(path.join(directory, 'session.enc'), corrupt);
  await assert.rejects(createAuthVault({ directory, safeStorage }), /stored sign-in/i);
  assert.deepEqual(await readFile(path.join(directory, 'session.enc')), corrupt);
});

test('vault flush reports failed encryption and never leaves plaintext or a temporary file', async t => {
  const safeStorage = encryption();
  safeStorage.encryptStringAsync = async () => { throw new Error('locked'); };
  const { vault, directory } = await fixture(t, safeStorage);
  vault.storage.setItem(authStorageKeys.session, 'never-write-this');
  await assert.rejects(vault.flush(), /securely save/i);
  assert.deepEqual(await readdir(directory), []);
  vault.storage.removeItem(authStorageKeys.session);
  await vault.flush();
});

test('vault can retry the latest secure update after the keychain is unlocked', async t => {
  const safeStorage = encryption();
  const encrypt = safeStorage.encryptStringAsync;
  safeStorage.encryptStringAsync = async () => { throw new Error('locked'); };
  const { vault, directory } = await fixture(t, safeStorage);
  vault.storage.setItem(authStorageKeys.session, 'recoverable-session');
  await assert.rejects(vault.flush());
  safeStorage.encryptStringAsync = encrypt;
  await vault.flush();
  const restored = await createAuthVault({ directory, safeStorage });
  assert.equal(restored.storage.getItem(authStorageKeys.session), 'recoverable-session');
});
