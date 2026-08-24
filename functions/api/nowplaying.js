// Cloudflare Pages Function: same-origin now-playing resolver for the public web app.
// Browsers cannot read ICY metadata and most platform status endpoints lack CORS, so
// without this the static deployment has no live now-playing feed at all. This function
// is deliberately narrow (GET, one stream URL, tight byte/time budgets, edge-cached)
// and keyless — it exposes nothing beyond what the station already broadcasts publicly.
//
// GET /api/nowplaying                -> availability probe
// GET /api/nowplaying?url=<stream>   -> { found, source, artist, title, raw, ... }

import { detectPlatformEndpoints, parsePlatformPayload } from '../../server/platform-detect.mjs';
import { parseNowPlaying } from '../../server/metadata-providers.mjs';
import { extractIcyTitle, icyReadBudget } from '../../server/icy-title.mjs';

const USER_AGENT = 'EarthRadio/0.24.0 pages-fn (+https://github.com/Protonmatter/EarthRadio)';
const PLATFORM_TIMEOUT_MS = 5000;
const ICY_TIMEOUT_MS = 8000;
const MAX_PLATFORM_BYTES = 256 * 1024;
const CACHE_TTL_FOUND_S = 15;
const CACHE_TTL_MISS_S = 60;

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const streamUrl = String(url.searchParams.get('url') || '').trim().slice(0, 2000);
  if (!streamUrl) {
    return json({ ok: true, service: 'earth-radio-pages-fn', endpoints: ['nowplaying', 'track/fingerprint'] }, 60);
  }

  const rejection = rejectStreamUrl(streamUrl);
  if (rejection) return json({ found: false, reason: rejection }, CACHE_TTL_MISS_S, 400);

  const cache = await openCache();
  const cacheKey = new Request(`https://cache.invalid/nowplaying?u=${encodeURIComponent(streamUrl)}`);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const payload = await resolveNowPlaying(streamUrl);
  const response = json(payload, payload.found ? CACHE_TTL_FOUND_S : CACHE_TTL_MISS_S);
  if (cache) await cache.put(cacheKey, response.clone()).catch(() => {});
  return response;
}

async function resolveNowPlaying(streamUrl) {
  const attempted = [];

  for (const endpoint of detectPlatformEndpoints(streamUrl)) {
    if (endpoint.kind === 'ws') continue;
    attempted.push(endpoint.platform);
    try {
      const text = await fetchTextCapped(endpoint.url, {
        timeoutMs: PLATFORM_TIMEOUT_MS,
        accept: endpoint.kind === 'sse' ? 'text/event-stream' : 'application/json',
        stopOn: endpoint.kind === 'sse' ? '\n\n' : ''
      });
      if (!text) continue;
      const result = parsePlatformPayload(endpoint, text);
      if (result) {
        return { found: true, source: 'platform', ...result, attempted, fetchedAt: new Date().toISOString() };
      }
    } catch { /* best-effort; next candidate */ }
  }

  attempted.push('icy');
  try {
    const icy = await readIcyOnce(streamUrl);
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

// One-shot ICY read: request metadata interleaving, read just enough bytes to see a
// couple of metadata blocks, extract the first StreamTitle, abort the stream.
async function readIcyOnce(streamUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ICY_TIMEOUT_MS);
  try {
    const response = await fetch(streamUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'Icy-MetaData': '1', 'User-Agent': USER_AGENT, Accept: '*/*' }
    });
    if (!response.ok || !response.body) return '';
    const metaint = Number.parseInt(response.headers.get('icy-metaint') || '', 10);
    const budget = icyReadBudget(metaint, 2);
    if (!budget) return '';

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (received < budget) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const merged = concat(chunks, received);
      const title = extractIcyTitle(merged, metaint);
      if (title) return title;
    }
    return extractIcyTitle(concat(chunks, received), metaint);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function fetchTextCapped(target, { timeoutMs, accept, stopOn }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: accept, 'User-Agent': USER_AGENT }
    });
    if (!response.ok || !response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (text.length < MAX_PLATFORM_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (stopOn && text.includes(stopOn)) break;
    }
    return text;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function concat(chunks, total) {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

// Cloudflare's egress cannot reach private ranges, but reject the obvious ones anyway
// so the function never proxies toward internal-looking names.
export function rejectStreamUrl(streamUrl) {
  let parsed;
  try {
    parsed = new URL(streamUrl);
  } catch {
    return 'invalid stream url';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return 'only http/https stream URLs are allowed';
  const host = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return 'private stream hosts are blocked';
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 'private stream hosts are blocked';
  if (host === '::1' || host.startsWith('fc') && host.includes(':') || host.startsWith('fd') && host.includes(':') || host.startsWith('fe80')) return 'private stream hosts are blocked';
  return '';
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
