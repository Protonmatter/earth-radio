import { mkdir, readFile, stat, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { authStorageKeys } from '../site/assets/auth-core.js';

const MAX_BYTES = 256 * 1024;

export async function createAuthVault({ directory, safeStorage }) {
  if (!await safeStorage?.isAsyncEncryptionAvailable?.()) {
    throw new Error('OS credential encryption is unavailable. Unlock your keychain and restart Earth Radio.');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'session.enc');
  const memory = new Map();
  let queue = Promise.resolve();
  let rotate = false;
  try {
    if ((await stat(filename)).size > MAX_BYTES) throw new Error('Oversized credential file.');
    const decrypted = await safeStorage.decryptStringAsync(await readFile(filename));
    if (typeof decrypted.result !== 'string' || Buffer.byteLength(decrypted.result) > MAX_BYTES) throw new Error('Invalid credential file.');
    memory.set(authStorageKeys.session, decrypted.result);
    rotate = decrypted.shouldReEncrypt === true;
  } catch (error) {
    // Keep platform/keychain diagnostics out of errors that may cross IPC.
    // eslint-disable-next-line preserve-caught-error
    if (error.code !== 'ENOENT') throw new Error('The stored sign-in could not be unlocked. Unlock your keychain and restart Earth Radio.');
  }
  async function persist(value) {
    if (value === null) { await rm(filename, { force: true }); return; }
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    try {
      const encrypted = await safeStorage.encryptStringAsync(value);
      if (!Buffer.isBuffer(encrypted) || encrypted.length > MAX_BYTES || !encrypted.length) throw new Error('Invalid ciphertext.');
      await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      await rename(temporary, filename);
    } catch {
      throw new Error('Could not securely save sign-in. Unlock your keychain and try again.');
    } finally { await rm(temporary, { force: true }); }
  }
  function enqueue(value) {
    queue = queue.catch(() => {}).then(() => persist(value));
    queue.catch(() => {});
  }
  const storage = {
    getItem: key => memory.get(key) ?? null,
    setItem(key, value) {
      if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_BYTES - 1024) throw new Error('Invalid sign-in storage value.');
      memory.set(key, value);
      if (key === authStorageKeys.session) enqueue(value);
    },
    removeItem(key) {
      memory.delete(key);
      if (key === authStorageKeys.session) enqueue(null);
    }
  };
  if (rotate) { enqueue(memory.get(authStorageKeys.session)); await queue; }
  return { storage, flush: async () => { await queue; } };
}
