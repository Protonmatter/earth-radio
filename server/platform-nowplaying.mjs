// Earth Radio hosting-platform now-playing resolvers.
// Many internet radio stations run on hosting platforms whose public APIs expose the
// real artist/title even when the ICY StreamTitle only carries the station name.
// Every candidate endpoint is derived from the station's own stream URL (or a fixed
// well-known platform API host) and fetched through the shared public-target guard.

import { requestLimited, resolvePublicTarget } from './net-guard.mjs';
import { createBoundedTtlCache, resolveWithCache } from './shared-cache.mjs';
import { detectPlatformEndpoints, parsePlatformPayload } from './platform-detect.mjs';
export { detectPlatformEndpoints, parsePlatformPayload } from './platform-detect.mjs';

const USER_AGENT = 'EarthRadio/0.24.0 platform-nowplaying (+https://github.com/Protonmatter/EarthRadio)';
const DEFAULT_TIMEOUT_MS = 6000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const CACHE_MAX_ENTRIES = 256;
const CACHE_TTL_HIT_MS = 20 * 1000;
const CACHE_TTL_MISS_MS = 5 * 60 * 1000;

const nowPlayingCache = createBoundedTtlCache({ maxEntries: CACHE_MAX_ENTRIES });
const inFlight = new Map();

export async function resolvePlatformNowPlaying(streamUrl, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchTextImpl = fetchTextGuarded } = {}) {
  const cacheKey = String(streamUrl || '').trim();
  if (!cacheKey) return notFound('missing stream url');
  return resolveWithCache({
    cache: nowPlayingCache,
    inFlight,
    key: cacheKey,
    produce: () => resolveUncached(cacheKey, { timeoutMs, fetchTextImpl }),
    ttlFor: payload => payload.found ? CACHE_TTL_HIT_MS : CACHE_TTL_MISS_MS
  });
}

async function resolveUncached(streamUrl, { timeoutMs, fetchTextImpl }) {
  const endpoints = detectPlatformEndpoints(streamUrl);
  const attempted = [];
  // One wall-clock budget across every candidate: the remaining time is divided over
  // the remaining endpoints, so a stalled first probe cannot consume the caller's whole
  // client timeout and starve the generic fallbacks, while a fast failure donates its
  // unused slice to the next endpoint.
  const deadlineAt = Date.now() + timeoutMs;
  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    const remaining = deadlineAt - Date.now();
    if (remaining <= 250) break;
    const budget = Math.max(250, Math.floor(remaining / (endpoints.length - index)));
    attempted.push(endpoint.platform);
    try {
      const text = await fetchTextImpl(endpoint, budget);
      if (!text) continue;
      const result = parsePlatformPayload(endpoint, text);
      if (result) return { ...result, found: true, endpoint: endpoint.url, attempted, fetchedAt: new Date().toISOString() };
    } catch {
      // Platform probing is best-effort; move on to the next candidate.
    }
  }
  return { ...notFound('no platform now-playing endpoint answered'), attempted };
}

async function fetchTextGuarded(endpoint, timeoutMs) {
  const target = await resolvePublicTarget(endpoint.url);
  const response = await requestLimited(target, {
    timeoutMs,
    maxBytes: MAX_RESPONSE_BYTES,
    // SSE subscriptions never end; stop after the first complete event frame.
    stopWhen: endpoint.kind === 'sse' ? ({ chunk, body }) => chunk.includes('\n\n') || body().includes('\n\n') : undefined,
    headers: {
      Accept: endpoint.kind === 'sse' ? 'text/event-stream' : 'application/json',
      'User-Agent': USER_AGENT
    }
  });
  if (response.statusCode < 200 || response.statusCode >= 300) return '';
  return response.text;
}

function notFound(reason) {
  return { found: false, reason };
}



export function clearPlatformNowPlayingCache() {
  nowPlayingCache.clear();
  inFlight.clear();
}
