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

import { createRateLimiter, guardedFetch, readBodyCapped, rejectFetchUrl } from '../_shared/guarded-fetch.js';
import { detectPlatformEndpoints, parsePlatformPayload } from '../../server/platform-detect.mjs';
import { parseNowPlaying } from '../../server/metadata-providers.mjs';
import { extractIcyTitle, icyReadBudget } from '../../server/icy-title.mjs';

const USER_AGENT = 'EarthRadio/0.24.0 pages-fn (+https://github.com/Protonmatter/EarthRadio)';
// One propagated deadline: specific platforms first, generic status probes in
// parallel, and at least ICY_RESERVED_MS is always left for the ICY fallback.
const TOTAL_BUDGET_MS = 16_000;
const PLATFORM_TIMEOUT_MS = 4000;
const ICY_RESERVED_MS = 8000;
const MAX_PLATFORM_BYTES = 256 * 1024;
const CACHE_TTL_FOUND_S = 15;
const CACHE_TTL_MISS_S = 60;

export const rejectStreamUrl = rejectFetchUrl;

const allowRequest = createRateLimiter({ windowMs: 60_000, max: 30 });

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const streamUrl = String(url.searchParams.get('url') || '').trim().slice(0, 2000);
  if (!streamUrl) {
    return json({ ok: true, service: 'earth-radio-pages-fn', endpoints: ['nowplaying', 'track/fingerprint'] }, 60);
  }

  const rejection = rejectFetchUrl(streamUrl);
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

  const payload = await resolveNowPlaying(streamUrl);
  const response = json(payload, payload.found ? CACHE_TTL_FOUND_S : CACHE_TTL_MISS_S);
  if (cache) await cache.put(cacheKey, response.clone()).catch(() => {});
  return response;
}

export async function resolveNowPlaying(streamUrl, { deadlineAt = Date.now() + TOTAL_BUDGET_MS } = {}) {
  const attempted = [];
  const endpoints = detectPlatformEndpoints(streamUrl).filter(endpoint => endpoint.kind !== 'ws');
  const generic = endpoints.filter(endpoint => endpoint.platform === 'icecast' || endpoint.platform === 'shoutcast');
  const specific = endpoints.filter(endpoint => !generic.includes(endpoint));

  // Hosted-platform endpoints answer fast and authoritatively.
  for (const endpoint of specific) {
    attempted.push(endpoint.platform);
    const result = await tryPlatform(endpoint, stageDeadline(deadlineAt)).catch(() => null);
    if (result) return found(result, attempted);
  }

  // Generic status probes run concurrently so slow hosts cannot serialize away the
  // budget the ICY fallback needs.
  const genericDeadline = stageDeadline(deadlineAt);
  if (generic.length && genericDeadline > Date.now()) {
    attempted.push(...generic.map(endpoint => endpoint.platform));
    const results = await Promise.all(generic.map(endpoint => tryPlatform(endpoint, genericDeadline).catch(() => null)));
    const hit = results.find(Boolean);
    if (hit) return found(hit, attempted);
  }

  attempted.push('icy');
  try {
    const icy = await readIcyOnce(streamUrl, deadlineAt);
    if (icy) {
      const track = parseNowPlaying(icy);
      if (track) {
        return { found: true, source: 'icy', platform: 'icy', artist: track.artist, title: track.title, raw: track.raw, attempted, fetchedAt: new Date().toISOString() };
      }
      return { found: false, reason: 'ICY title was junk or station text', raw: icy, attempted };
    }
  } catch { /* fall through */ }

  return { found: false, reason: 'no now-playing source answered', attempted };
}

function stageDeadline(deadlineAt) {
  return Math.min(Date.now() + PLATFORM_TIMEOUT_MS, deadlineAt - ICY_RESERVED_MS);
}

function found(result, attempted) {
  return { found: true, source: 'platform', ...result, attempted, fetchedAt: new Date().toISOString() };
}

async function tryPlatform(endpoint, deadlineAt) {
  if (deadlineAt <= Date.now()) return null;
  const { response } = await guardedFetch(endpoint.url, {
    deadlineAt,
    headers: { Accept: endpoint.kind === 'sse' ? 'text/event-stream' : 'application/json', 'User-Agent': USER_AGENT }
  });
  if (!response.ok) return null;
  const bytes = await readBodyCapped(response, {
    maxBytes: MAX_PLATFORM_BYTES,
    deadlineAt,
    stopWhen: endpoint.kind === 'sse' ? ({ body }) => new TextDecoder().decode(body()).includes('\n\n') : undefined
  });
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  return parsePlatformPayload(endpoint, text);
}

// One-shot ICY read: request metadata interleaving, read just enough bytes to see a
// couple of metadata blocks, extract the first StreamTitle, abort the stream.
async function readIcyOnce(streamUrl, deadlineAt) {
  const { response } = await guardedFetch(streamUrl, {
    deadlineAt,
    headers: { 'Icy-MetaData': '1', 'User-Agent': USER_AGENT, Accept: '*/*' }
  });
  if (!response.ok || !response.body) return '';
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

function json(body, maxAgeSeconds, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAgeSeconds}`
    }
  });
}
