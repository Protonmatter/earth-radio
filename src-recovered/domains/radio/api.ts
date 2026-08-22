// Radio data layer: resilient directory fetch (proxy federated endpoint or direct mirror
// failover), IndexedDB cache with stale fallback, and best-effort click telemetry.
import { DIRECT_RADIO_BROWSER_BASES, getRuntimeConfig, type RuntimeConfig } from '../../core/config';
import { summarizeStationSources } from '../../core/sourceGraph.js';
import { dbGet, dbSet } from '../../core/db';
import { getBadStations } from '../../core/storage';
import { normalizeStation } from './normalize';
import './sources.js';
import type { DirectoryResult, Station, SourceSummary } from '../../core/types';

const CACHE_STORE = 'cache';
const CACHE_KEY = 'stations.v3';
const LEGACY_CACHE_KEY = 'earthRadio.stations.cache.v3';
// The federated, per-country directory build can take ~15-20s on a cold cache, so the
// one-time directory fetch gets a much longer budget than quick calls (probe/click).
const DIRECTORY_TIMEOUT_MS = 60_000;

interface CachedStations {
  schema: number;
  savedAt: number;
  source: string;
  stations: Station[];
}

export async function fetchStations({ forceRefresh = false } = {}): Promise<DirectoryResult> {
  const config = getRuntimeConfig();
  const cached = await readStationCache(config.stationCacheTtlMs);

  if (!forceRefresh && cached?.stations?.length) {
    return {
      stations: cached.stations,
      source: cached.source || 'cache',
      sourceSummary: summarizeStationSources(cached.stations),
      cached: true,
      stale: false
    };
  }

  try {
    const result = await fetchStationsLive(config);
    await writeStationCache(result.stations, result.source);
    return { ...result, cached: false, stale: false };
  } catch (error) {
    const stale = await readStationCache(Number.POSITIVE_INFINITY);
    if (stale?.stations?.length) {
      return {
        stations: stale.stations,
        source: stale.source || 'stale-cache',
        sourceSummary: summarizeStationSources(stale.stations),
        cached: true,
        stale: true,
        error
      };
    }
    throw error;
  }
}

async function fetchStationsLive(config: RuntimeConfig): Promise<{ stations: Station[]; source: string; sourceSummary: SourceSummary }> {
  const limit = encodeURIComponent(String(config.stationLimit));

  if (config.proxyBaseUrl) {
    const proxyBase = trimTrailingSlash(config.proxyBaseUrl);
    const federatedEndpoint = config.useFederatedIndex !== false
      ? `${proxyBase}/api/stations/federated?limit=${limit}`
      : `${proxyBase}/api/stations/top?limit=${limit}`;
    const payload = await fetchJson(federatedEndpoint, DIRECTORY_TIMEOUT_MS);
    return normalizeStationPayload(payload, payload?.source || proxyBase);
  }

  const errors: string[] = [];
  for (const base of DIRECT_RADIO_BROWSER_BASES) {
    try {
      const url = `${base}/json/stations/topclick/${limit}?hidebroken=true`;
      const payload = await fetchJson(url, DIRECTORY_TIMEOUT_MS);
      return normalizeStationPayload(payload, base);
    } catch (error) {
      errors.push(`${base}: ${(error as Error).message}`);
    }
  }

  throw new Error(`Radio Browser API unavailable. Tried ${errors.length} endpoints. ${errors.join(' | ')}`);
}

function normalizeStationPayload(payload: any, source: string): { stations: Station[]; source: string; sourceSummary: SourceSummary } {
  const rawStations = Array.isArray(payload) ? payload : payload?.stations;
  if (!Array.isArray(rawStations)) throw new Error('Invalid station response shape');

  const badStations = getBadStations();
  const seen = new Set<string>();
  const stations: Station[] = [];

  for (const raw of rawStations) {
    const normalized = normalizeStation(raw, badStations);
    if (!normalized) continue;
    if (seen.has(normalized.stationuuid)) continue;
    seen.add(normalized.stationuuid);
    stations.push(normalized);
  }

  stations.sort((a, b) => b.quality.score - a.quality.score || b.clickcount - a.clickcount || a.name.localeCompare(b.name));
  return { stations, source, sourceSummary: summarizeStationSources(stations, payload?.sources) };
}

export async function recordStationClick(station: Station | null): Promise<unknown> {
  if (!station?.stationuuid) return null;

  const config = getRuntimeConfig();
  const endpoints = config.proxyBaseUrl
    ? [`${trimTrailingSlash(config.proxyBaseUrl)}/api/stations/click/${encodeURIComponent(station.stationuuid)}`]
    : DIRECT_RADIO_BROWSER_BASES.map(base => `${base}/json/url/${encodeURIComponent(station.stationuuid)}`);

  for (const endpoint of endpoints) {
    try {
      return await fetchJson(endpoint, Math.min(config.apiTimeoutMs, 5000));
    } catch {
      // Best-effort telemetry; playback must never depend on it.
    }
  }
  return null;
}

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readStationCache(maxAgeMs: number): Promise<CachedStations | null> {
  let parsed = await dbGet<CachedStations>(CACHE_STORE, CACHE_KEY);
  if (!parsed) parsed = migrateLegacyCache() ?? undefined;
  if (!parsed || !Array.isArray(parsed.stations)) return null;
  const ageMs = Date.now() - Number(parsed.savedAt || 0);
  if (ageMs > maxAgeMs) return null;
  return parsed;
}

async function writeStationCache(stations: Station[], source: string): Promise<void> {
  await dbSet(CACHE_STORE, CACHE_KEY, { schema: 3, savedAt: Date.now(), source, stations } satisfies CachedStations);
}

function migrateLegacyCache(): CachedStations | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LEGACY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    localStorage.removeItem(LEGACY_CACHE_KEY);
    return Array.isArray(parsed?.stations) ? parsed : null;
  } catch {
    return null;
  }
}

function trimTrailingSlash(value: string): string {
  return String(value || '').replace(/\/+$/, '');
}
