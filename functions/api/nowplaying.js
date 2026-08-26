// Cloudflare Pages Function: same-origin now-playing resolver for the public web app.
// Browsers cannot read ICY metadata and most platform status endpoints lack CORS, so
// without this the static deployment has no live now-playing feed at all. All outbound
// traffic goes through the shared guarded boundary (functions/_shared/guarded-fetch.js):
// manual, revalidated redirects with a hop cap, byte caps, and one absolute wall-clock
// deadline per request. Zone-level WAF rate limits (docs/OPERATIONS.md) sit in front;
// the in-function limiter here is defense in depth.
//
// GET /api/nowplaying                -> availability probe
// GET /api/nowplaying?url=<stream>   -> { found, source, artist, title, raw, ... }

import { createRateLimiter, fetchPublic, readBodyCapped, rejectFetchUrl } from '../_shared/guarded-fetch.js';
import { detectPlatformEndpoints, parsePlatformPayload, sseFrameComplete } from '../../server/platform-detect.mjs';
import { parseNowPlaying } from '../../server/metadata-providers.mjs';
import { extractIcyTitle, icyReadBudget } from '../../server/icy-title.mjs';

const USER_AGENT = 'EarthRadio/0.24.0 pages-fn (+https://github.com/Protonmatter/EarthRadio)';
// One propagated deadline: specific platforms first, generic status probes in
// parallel, and at least ICY_RESERVED_MS is always left for the ICY fallback.
const TOTAL_BUDGET_MS = 11_000;
const PLATFORM_TIMEOUT_MS = 4000;
const ICY_RESERVED_MS = 8000;
const MAX_PLATFORM_BYTES = 256 * 1024;
const CACHE_TTL_FOUND_S = 15;
const CACHE_TTL_MISS_S = 60;
const DO_NOT_CACHE = Symbol('do-not-cache');

export const rejectStreamUrl = rejectFetchUrl;

const allowRequest = createRateLimiter({ windowMs: 60_000, max: 30 });

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const forbiddenOrigins = [url.origin];
  const streamUrl = String(url.searchParams.get('url') || '').trim().slice(0, 2000);
  if (!streamUrl) {
    return json({ ok: true, service: 'earth-radio-pages-fn', endpoints: ['nowplaying', 'track/fingerprint'] }, 60);
  }

  const rejection = rejectFetchUrl(streamUrl, { forbiddenOrigins });
  if (rejection) return json({ found: false, reason: rejection }, CACHE_TTL_MISS_S, 400);

  const cache = await openCache();
  const cacheKey = new Request(`https://cache.invalid/nowplaying?u=${encodeURIComponent(streamUrl)}`);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  if (!allowRequest(request)) {
    return new Response(JSON.stringify({ error: 'rate limit exceeded' }), {
      status: 429,
      headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '60', 'cache-control': 'no-store' }
    });
  }

  const deadlineAt = Date.now() + TOTAL_BUDGET_MS;
  const payload = await resolveNowPlaying(streamUrl, { deadlineAt, forbiddenOrigins });
  const cacheable = !payload[DO_NOT_CACHE];
  const response = json(payload, cacheable ? (payload.found ? CACHE_TTL_FOUND_S : CACHE_TTL_MISS_S) : 0);
  if (cache && cacheable) await cache.put(cacheKey, response.clone()).catch(() => {});
  return response;
}

export async function resolveNowPlaying(streamUrl, {
  deadlineAt = Date.now() + TOTAL_BUDGET_MS,
  forbiddenOrigins = []
} = {}) {
  const attempted = [];
  const endpoints = detectPlatformEndpoints(streamUrl).filter(endpoint => endpoint.kind !== 'ws');
  const generic = endpoints.filter(endpoint => endpoint.platform === 'icecast' || endpoint.platform === 'shoutcast');
  const specific = endpoints.filter(endpoint => !generic.includes(endpoint));

  // Hosted-platform endpoints answer fast and authoritatively.
  for (const endpoint of specific) {
    attempted.push(endpoint.platform);
    const result = await tryPlatform(endpoint, stageDeadline(deadlineAt), forbiddenOrigins).catch(() => null);
    if (result) return found(result, attempted);
  }

  // Generic status probes run concurrently so slow hosts cannot serialize away the
  // budget the ICY fallback needs.
  const genericDeadline = stageDeadline(deadlineAt);
  if (generic.length && genericDeadline > Date.now()) {
    attempted.push(...generic.map(endpoint => endpoint.platform));
    const results = await Promise.all(generic.map(endpoint => tryPlatform(endpoint, genericDeadline, forbiddenOrigins).catch(() => null)));
    const hit = results.find(Boolean);
    if (hit) return found(hit, attempted);
  }

  attempted.push('icy');
  try {
    const icy = await readIcyOnce(streamUrl, deadlineAt, forbiddenOrigins);
    if (icy) {
      const track = parseNowPlaying(icy);
      if (track) {
        return { found: true, source: 'icy', platform: 'icy', artist: track.artist, title: track.title, raw: track.raw, attempted, fetchedAt: new Date().toISOString() };
      }
      return { found: false, reason: 'ICY title was junk or station text', raw: icy, attempted };
    }
  } catch (error) {
    if (isDeadlineError(error)) {
      const payload = {
        found: false,
        timeout: true,
        reason: 'now-playing deadline exceeded',
        attempted
      };
      Object.defineProperty(payload, DO_NOT_CACHE, { value: true });
      return payload;
    }
  }

  return { found: false, reason: 'no now-playing source answered', attempted };
}

function stageDeadline(deadlineAt) {
  return Math.min(Date.now() + PLATFORM_TIMEOUT_MS, deadlineAt - ICY_RESERVED_MS);
}

function found(result, attempted) {
  return { found: true, source: 'platform', ...result, attempted, fetchedAt: new Date().toISOString() };
}

async function tryPlatform(endpoint, deadlineAt, forbiddenOrigins) {
  if (deadlineAt <= Date.now()) return null;
  const response = await fetchPublic(endpoint.url, {
    deadlineAt,
    forbiddenOrigins,
    headers: { Accept: endpoint.kind === 'sse' ? 'text/event-stream' : 'application/json', 'User-Agent': USER_AGENT }
  });
  if (!response.ok) {
    cancelResponseBody(response);
    return null;
  }
  const bytes = await readBodyCapped(response, {
    maxBytes: MAX_PLATFORM_BYTES,
    deadlineAt,
    // Stop only after a complete data event; Zeno may delimit frames with CRLF
    // blank lines and open with a heartbeat frame that carries no data: line.
    stopWhen: endpoint.kind === 'sse' ? ({ body }) => sseFrameComplete(new TextDecoder().decode(body())) : undefined
  });
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  return parsePlatformPayload(endpoint, text);
}

// One-shot ICY read: request metadata interleaving, read just enough bytes to see a
// couple of metadata blocks, extract the first StreamTitle, abort the stream.
async function readIcyOnce(streamUrl, deadlineAt, forbiddenOrigins) {
  const response = await fetchPublic(streamUrl, {
    deadlineAt,
    forbiddenOrigins,
    headers: { 'Icy-MetaData': '1', 'User-Agent': USER_AGENT, Accept: '*/*' }
  });
  if (!response.ok || !response.body) {
    cancelResponseBody(response);
    return '';
  }
  const metaint = Number.parseInt(response.headers.get('icy-metaint') || '', 10);
  const budget = icyReadBudget(metaint, 2);
  if (!budget) {
    response.body.cancel?.().catch?.(() => {});
    return '';
  }
  const bytes = await readBodyCapped(response, {
    maxBytes: budget,
    deadlineAt,
    stopWhen: ({ body }) => extractIcyTitle(body(), metaint) !== ''
  });
  return extractIcyTitle(bytes, metaint);
}

async function openCache() {
  try {
    return globalThis.caches?.default || (globalThis.caches?.open ? await globalThis.caches.open('earth-radio-nowplaying') : null);
  } catch {
    return null;
  }
}

function cancelResponseBody(response) {
  response?.body?.cancel?.().catch?.(() => {});
}

function isDeadlineError(error) {
  return /deadline/i.test(String(error?.message || ''));
}

function json(body, maxAgeSeconds, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAgeSeconds > 0 ? `public, max-age=${maxAgeSeconds}` : 'no-store'
    }
  });
}
