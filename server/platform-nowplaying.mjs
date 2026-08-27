// Earth Radio hosting-platform now-playing resolvers.
// Many internet radio stations run on hosting platforms whose public APIs expose the
// real artist/title even when the ICY StreamTitle only carries the station name.
// Every candidate endpoint is derived from the station's own stream URL (or a fixed
// well-known platform API host) and fetched through the shared public-target guard.

import { requestPublic } from './net-guard.mjs';
import { createBoundedTtlCache, resolveWithCache } from './shared-cache.mjs';
import { detectPlatformEndpoints, parsePlatformPayload, sseFrameComplete } from './platform-detect.mjs';
export { detectPlatformEndpoints, parsePlatformPayload, somafmStationId } from './platform-detect.mjs';

const USER_AGENT = 'EarthRadio/0.24.0 platform-nowplaying (+https://github.com/Protonmatter/EarthRadio)';
const DEFAULT_TIMEOUT_MS = 6000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const CACHE_MAX_ENTRIES = 256;
const CACHE_TTL_HIT_MS = 20 * 1000;
// The browser polls platform feeds every 30 seconds. A genuine miss or temporary
// transport failure must be retried on that cadence instead of hiding recovery for
// five minutes.
const CACHE_TTL_MISS_MS = 30 * 1000;

const nowPlayingCache = createBoundedTtlCache({ maxEntries: CACHE_MAX_ENTRIES });
const inFlight = new Map();

export async function resolvePlatformNowPlaying(streamUrl, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  deadlineAt = Date.now() + timeoutMs,
  signal,
  fetchTextImpl = fetchTextGuarded
} = {}) {
  const cacheKey = String(streamUrl || '').trim();
  if (!cacheKey) return notFound('missing stream url');
  const deadline = Number(deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) return notFound('platform resolution deadline exceeded');
  return withinResolutionDeadline(resolveWithCache({
    cache: nowPlayingCache,
    inFlight,
    key: cacheKey,
    produce: () => resolveUncached(cacheKey, { deadlineAt: deadline, signal, fetchTextImpl }),
    ttlFor: payload => payload.found ? CACHE_TTL_HIT_MS : CACHE_TTL_MISS_MS
  }), deadline, signal);
}

async function resolveUncached(streamUrl, { deadlineAt, signal, fetchTextImpl }) {
  const endpoints = detectPlatformEndpoints(streamUrl);
  const attempted = [];
  const generic = endpoints.filter(endpoint => endpoint.platform === 'icecast' || endpoint.platform === 'shoutcast');
  const specialized = endpoints.filter(endpoint => endpoint.platform !== 'icecast' && endpoint.platform !== 'shoutcast');

  for (let index = 0; index < specialized.length; index += 1) {
    const endpoint = specialized[index];
    const remaining = deadlineAt - Date.now();
    if (remaining <= 250) break;
    // A stalled specialized endpoint must never consume the whole resolution window:
    // half of the remaining budget stays reserved for the generic fallbacks, and the
    // other half is divided across the remaining specialized candidates.
    const stageDeadlineAt = Math.min(
      deadlineAt,
      Date.now() + Math.max(250, Math.floor(remaining / (2 * (specialized.length - index))))
    );
    attempted.push(endpoint.platform);
    try {
      const result = await probeEndpoint(endpoint, { deadlineAt: stageDeadlineAt, signal, fetchTextImpl });
      if (result) return { ...result, found: true, endpoint: endpoint.url, attempted, fetchedAt: new Date().toISOString() };
    } catch {
      // Platform probing is best-effort; move on to the next candidate.
    }
  }

  // Icecast and Shoutcast status endpoints are independent views of the same stream
  // origin. Probe both under the one remaining operation budget, then choose the
  // first valid result in deterministic endpoint order after every request settles.
  attempted.push(...generic.map(endpoint => endpoint.platform));
  const genericResults = await Promise.allSettled(generic.map(endpoint => (
    probeEndpoint(endpoint, { deadlineAt, signal, fetchTextImpl })
  )));
  for (let index = 0; index < genericResults.length; index += 1) {
    const outcome = genericResults[index];
    if (outcome.status === 'fulfilled' && outcome.value) {
      const endpoint = generic[index];
      return { ...outcome.value, found: true, endpoint: endpoint.url, attempted, fetchedAt: new Date().toISOString() };
    }
  }
  return { ...notFound('no platform now-playing endpoint answered'), attempted };
}

async function probeEndpoint(endpoint, { deadlineAt, signal, fetchTextImpl }) {
  const text = await withinResolutionDeadline(
    fetchTextImpl(endpoint, { deadlineAt, signal }),
    deadlineAt,
    signal
  );
  return text ? parsePlatformPayload(endpoint, text) : null;
}

async function fetchTextGuarded(endpoint, { deadlineAt, signal } = {}) {
  const response = await requestPublic(endpoint.url, {
    deadlineAt,
    signal,
    maxBytes: MAX_RESPONSE_BYTES,
    // SSE subscriptions never end; stop after the first complete data event,
    // whichever blank-line convention (LF or CRLF) the server uses.
    stopWhen: endpoint.kind === 'sse' ? ({ body }) => sseFrameComplete(body().toString('utf8')) : undefined,
    headers: {
      Accept: endpoint.kind === 'sse' ? 'text/event-stream' : 'application/json',
      'User-Agent': USER_AGENT
    }
  });
  if (response.statusCode < 200 || response.statusCode >= 300) return '';
  return response.text;
}

function withinResolutionDeadline(promise, deadlineAt, signal) {
  const remaining = Number(deadlineAt) - Date.now();
  if (remaining <= 0) return Promise.reject(new Error('platform resolution deadline exceeded'));
  if (signal?.aborted) return Promise.reject(new Error('platform resolution aborted'));
  let timer;
  let onAbort;
  const races = [Promise.resolve(promise), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('platform resolution deadline exceeded')), remaining);
  })];
  if (signal) {
    races.push(new Promise((_, reject) => {
      onAbort = () => reject(new Error('platform resolution aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    }));
  }
  return Promise.race(races).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

function notFound(reason) {
  return { found: false, reason };
}



export function clearPlatformNowPlayingCache() {
  nowPlayingCache.clear();
  inFlight.clear();
}
