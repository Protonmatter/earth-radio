import { coordinates, streamIdentity } from './discovery-core.js?v=0.29.0';

const BASES = ['https://de1.api.radio-browser.info', 'https://all.api.radio-browser.info'];
const LIMIT = 10000;
const MAX_BYTES = 16 * 1024 * 1024;

// Radio Browser exposes has_geo_info, not viewport bounds. Load one bounded
// global mapped sample on demand, then apply the captured rectangle locally.
// No stream URLs are fetched here. Successful results are reused for this tab.
export function createMapDirectory({ fetchImpl = globalThis.fetch, timeoutMs = 20000, maxBytes = MAX_BYTES, limit = LIMIT } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT ||
      !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000) throw new Error('Invalid map directory limits');
  let cached = null, pending = null, active = null;
  function load() {
    if (cached) return Promise.resolve(cached);
    if (pending) return pending;
    const controller = new AbortController();
    active = controller;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const task = (async () => {
      for (const base of BASES) {
        controller.signal.throwIfAborted();
        try {
          const query = new URLSearchParams({ has_geo_info: 'true', hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(limit) });
          const response = await fetchImpl(`${base}/json/stations/search?${query}`, {
            signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit'
          });
          if (!response.ok) { await response.body?.cancel(); throw new Error('Directory unavailable'); }
          if (Number(response.headers.get('content-length')) > maxBytes) {
            await response.body?.cancel(); throw new Error('Directory response too large');
          }
          if (!response.body) throw new Error('Missing directory body');
          const reader = response.body.getReader(), chunks = [];
          let bytes = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              controller.signal.throwIfAborted();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > maxBytes) { await reader.cancel(); throw new Error('Directory response too large'); }
              chunks.push(value);
            }
          } finally { reader.releaseLock(); }
          const body = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
          const rows = JSON.parse(new TextDecoder().decode(body));
          if (!Array.isArray(rows) || rows.length > limit) throw new Error('Invalid directory response');
          controller.signal.throwIfAborted();
          const seen = new Set();
          const stations = rows.filter(row => {
            if (!row || typeof row !== 'object' || typeof row.stationuuid !== 'string' || !row.stationuuid || row.stationuuid.length > 128 ||
                typeof row.name !== 'string' || !row.name.trim() || row.name.length > 512 ||
                ![row.geo_lat, row.geo_long].every(value => typeof value === 'number' || typeof value === 'string') ||
                !coordinates(row) || !streamIdentity(row) || seen.has(row.stationuuid)) return false;
            seen.add(row.stationuuid); return true;
          });
          cached = { stations, limited: rows.length === limit };
          return cached;
        } catch {
          controller.signal.throwIfAborted();
        }
      }
      throw new Error('Mapped station directory unavailable');
    })().finally(() => {
      clearTimeout(timer);
      if (pending === task) pending = null;
      if (active === controller) active = null;
    });
    pending = task;
    return task;
  }
  return { load, cancel() { active?.abort(); active = null; pending = null; } };
}

// Retain the runtime's richer federated records, adding only missing locations.
export function mergeMappedStations(base, mapped) {
  const merged = new Map(mapped.map(station => [station.stationuuid, station]));
  for (const station of base) {
    const located = merged.get(station.stationuuid);
    merged.set(station.stationuuid, located && !coordinates(station)
      ? { ...station, geo_lat: located.geo_lat, geo_long: located.geo_long } : station);
  }
  return [...merged.values()];
}
