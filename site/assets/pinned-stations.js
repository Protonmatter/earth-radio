import {LISTEN_MOE_STATIONS} from './direct-stations.js?v=0.37.0';
import {getSharedStation,restoreCachedSharedStation} from './sharing-entry.js?v=0.37.0';
export {LISTEN_MOE_STATIONS};

// Earth Radio git-catalogued stations that Radio Browser is not allowed to omit.
// LISTEN.moe is a first-class station: J-pop and K-pop MP3 fallbacks plus the
// matching wss://listen.moe gateway the metadata overlay already knows how to read.
// The recovered hashed bundle owns directory fetch and IndexedDB cache; this overlay
// loads first, merges the asserted records into both paths, and never mutates inputs.

export const CACHE_STORE = 'cache';
export const CACHE_KEY = 'stations.v3';

export function isDirectoryRequest(url) {
  try {
    const parsed = new URL(String(url || ''), 'https://earth-radio.invalid');
    // Geo samples have a strict record budget and require actual locations.
    // The pinned stations are already retained by the main catalog.
    if (parsed.searchParams.get('has_geo_info') === 'true') return false;
    const path = parsed.pathname;
    return /\/json\/stations\//.test(path) || /\/api\/stations\/(federated|top)\b/.test(path);
  } catch {
    return false;
  }
}

function defaultPinnedStations() {
  const shared=getSharedStation();
  return shared&&!LISTEN_MOE_STATIONS.some(station=>station.stationuuid===shared.stationuuid)
    ?[...LISTEN_MOE_STATIONS,shared]:LISTEN_MOE_STATIONS;
}

export function mergePinnedStations(payload, pinned = defaultPinnedStations()) {
  if (Array.isArray(payload)) return mergeStationList(payload, pinned);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.stations)) return payload;
  return { ...payload, stations: mergeStationList(payload.stations, pinned) };
}

function mergeStationList(stations, pinned) {
  const seen = new Set(
    stations.map(station => String(station?.stationuuid || station?.uuid || '')).filter(Boolean)
  );
  const extra = pinned.filter(station => !seen.has(station.stationuuid));
  return extra.length ? [...stations, ...extra] : stations;
}

export function installDirectoryFetchPatch(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return fetchImpl;
  if (fetchImpl.__earthRadioPinnedStations) return fetchImpl;
  const patched = async function patchedFetch(input, init) {
    const response = await fetchImpl(input, init);
    const url = typeof input === 'string' || input instanceof URL
      ? String(input)
      : String(input?.url || '');
    if (!isDirectoryRequest(url) || !response.ok) return response;
    try {
      const payload = mergePinnedStations(await response.clone().json());
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch {
      return response;
    }
  };
  Object.defineProperty(patched, '__earthRadioPinnedStations', { value: true });
  return patched;
}

export async function mergePinnedStationCache({
  indexedDBImpl = globalThis.indexedDB,
  stations
} = {}) {
  if (!indexedDBImpl) return false;
  const db = await openDatabase(indexedDBImpl);
  if (!db) return false;
  try {
    if (!db.objectStoreNames.contains(CACHE_STORE)) return false;
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, 'readwrite');
      const store = transaction.objectStore(CACHE_STORE);
      const request = store.get(CACHE_KEY);
      request.onerror = () => reject(request.error || new Error('station cache read failed'));
      request.onsuccess = () => {
        const cached = request.result;
        if (!cached || !Array.isArray(cached.stations)) {
          resolve(false);
          return;
        }
        // Keep an explicitly requested, already cached public station available
        // across a later fresh-catalog cutoff. Reuse this cache; no new history key.
        if(stations===undefined)restoreCachedSharedStation(cached.stations);
        const stationsMerged = mergeStationList(cached.stations, stations===undefined?defaultPinnedStations():stations);
        if (stationsMerged === cached.stations) {
          resolve(false);
          return;
        }
        store.put({ ...cached, stations: stationsMerged }, CACHE_KEY);
      };
      transaction.oncomplete = () => resolve(true);
      transaction.onabort = () => reject(transaction.error || new Error('station cache merge aborted'));
    });
  } catch {
    return false;
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

function openDatabase(indexedDBImpl) {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDBImpl.open('earthRadio', 1);
      request.onerror = () => reject(request.error || new Error('indexeddb unavailable'));
      request.onsuccess = () => resolve(request.result);
    } catch (error) {
      reject(error);
    }
  }).catch(() => null);
}

async function bootBrowser() {
  // Consume the verified path entry even without an existing catalog cache.
  // The directory owner can then recover this exact row after an upstream outage.
  getSharedStation();
  await mergePinnedStationCache();
  if (typeof window !== 'undefined' && window.fetch) {
    window.fetch = installDirectoryFetchPatch(window.fetch.bind(window));
  }
}

const inBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
if (inBrowser) await bootBrowser();
