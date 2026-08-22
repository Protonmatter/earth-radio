// Proxy-backed stream probe client with a short-lived IndexedDB observation cache.
import { getRuntimeConfig } from './config';
import { dbGet, dbSet } from './db';
import type { Observation, Station } from './types';

const PROBE_TTL_MS = 5 * 60 * 1000;

interface CachedProbe {
  savedAt: number;
  observation: Observation;
}

export async function probeStationStream(station: Station | null, { forceRefresh = false } = {}): Promise<Observation | null> {
  const url = station?.url_resolved || station?.url;
  if (!url) return null;

  const config = getRuntimeConfig();
  if (!config.proxyBaseUrl) return null;

  if (!forceRefresh) {
    const cached = await readProbeCache(url);
    if (cached) return cached;
  }

  const endpoint = `${trimTrailingSlash(config.proxyBaseUrl)}/api/streams/probe?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('probe timeout')), Math.min(config.apiTimeoutMs, 8000));

  try {
    const response = await fetch(endpoint, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`probe HTTP ${response.status}`);
    const observation = (await response.json()) as Observation;
    await writeProbeCache(url, observation);
    return observation;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readProbeCache(url: string): Promise<Observation | null> {
  const record = await dbGet<CachedProbe>('cache', `probe:${url}`);
  if (!record || Date.now() - Number(record.savedAt || 0) > PROBE_TTL_MS) return null;
  return record.observation || null;
}

async function writeProbeCache(url: string, observation: Observation): Promise<void> {
  await dbSet('cache', `probe:${url}`, { savedAt: Date.now(), observation } satisfies CachedProbe);
}

function trimTrailingSlash(value: string): string {
  return String(value || '').replace(/\/+$/, '');
}
