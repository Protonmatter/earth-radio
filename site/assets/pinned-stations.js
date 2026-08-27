// Earth Radio git-catalogued stations that Radio Browser is not allowed to omit.
// LISTEN.moe is a first-class station: J-pop and K-pop MP3 fallbacks plus the
// matching wss://listen.moe gateway the metadata overlay already knows how to read.
// The recovered hashed bundle owns directory fetch and IndexedDB cache; this overlay
// loads first, merges the asserted records into both paths, and never mutates inputs.

export const CACHE_STORE = 'cache';
export const CACHE_KEY = 'stations.v3';

export const LISTEN_MOE_STATIONS = Object.freeze([
  Object.freeze({
    stationuuid: 'earth-radio:listen.moe:jpop',
    changeuuid: 'earth-radio:listen.moe:jpop:v1',
    name: 'LISTEN.moe',
    url: 'https://listen.moe/fallback',
    url_resolved: 'https://listen.moe/fallback',
    homepage: 'https://listen.moe/',
    favicon: 'https://listen.moe/favicon.ico',
    tags: 'jpop,anime,listen.moe',
    country: 'Japan',
    countrycode: 'JP',
    language: 'japanese',
    votes: 5000,
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    clickcount: 8000,
    geo_lat: 35.6895,
    geo_long: 139.6917,
    source: 'direct'
  }),
  Object.freeze({
    stationuuid: 'earth-radio:listen.moe:kpop',
    changeuuid: 'earth-radio:listen.moe:kpop:v1',
    name: 'LISTEN.moe Kpop',
    url: 'https://listen.moe/kpop/fallback',
    url_resolved: 'https://listen.moe/kpop/fallback',
    homepage: 'https://listen.moe/',
    favicon: 'https://listen.moe/favicon.ico',
    tags: 'kpop,listen.moe',
    country: 'The Republic Of Korea',
    countrycode: 'KR',
    language: 'korean',
    votes: 5000,
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    clickcount: 7900,
    geo_lat: 37.5665,
    geo_long: 126.978,
    source: 'direct'
  })
]);

export function isDirectoryRequest(url) {
  try {
    const path = new URL(String(url || ''), 'https://earth-radio.invalid').pathname;
    return /\/json\/stations\//.test(path) || /\/api\/stations\/(federated|top)\b/.test(path);
  } catch {
    return false;
  }
}

export function mergePinnedStations(payload, pinned = LISTEN_MOE_STATIONS) {
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
  stations = LISTEN_MOE_STATIONS
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
        const stationsMerged = mergeStationList(cached.stations, stations);
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
  await mergePinnedStationCache();
  if (typeof window !== 'undefined' && window.fetch) {
    window.fetch = installDirectoryFetchPatch(window.fetch.bind(window));
  }
}

const inBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
if (inBrowser) await bootBrowser();
