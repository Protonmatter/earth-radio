// Thin IndexedDB wrapper (via idb). Two stores: `kv` for small JSON records (favorites,
// recents, preferences, playback failures) and `cache` for large blobs (directory + probes).
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'earthRadio';
const DB_VERSION = 1;

export type StoreName = 'kv' | 'cache';

let dbPromise: Promise<IDBPDatabase> | null = null;

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      }
    });
  }
  return dbPromise;
}

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  if (!isIndexedDbAvailable()) return undefined;
  try {
    return (await (await getDb()).get(store, key)) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function dbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    await (await getDb()).put(store, value, key);
  } catch {
    // Storage may be unavailable (private mode / quota); features degrade gracefully.
  }
}

export async function dbDelete(store: StoreName, key: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    await (await getDb()).delete(store, key);
  } catch {
    // ignore
  }
}
