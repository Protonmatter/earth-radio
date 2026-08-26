// Cloudflare Pages Function: on-demand audio fingerprinting for the public web app.
// Mirrors the desktop proxy's /api/track/fingerprint contract. Strictly opt-in: without
// ACRCloud (ACR_HOST/ACR_ACCESS_KEY/ACR_ACCESS_SECRET) or AudD (AUDD_API_TOKEN)
// environment variables configured on the Pages project, every request reports
// available: false and the client hides the identify button. All stream traffic goes
// through the shared guarded boundary (manual revalidated redirects, byte caps, one
// wall-clock deadline); HLS playlists are resolved and recent segments sampled the same
// way the desktop implementation does. Rate limiting for this metered route is
// enforced exclusively by the zone-level WAF rules (6 requests/min/IP, HTTP 429;
// docs/CLOUDFLARE_DEPLOYMENT.md): a per-isolate counter multiplies by isolate count
// and would misrepresent the real budget, so production policy has one durable
// source of truth.
//
// GET /api/track/fingerprint                 -> availability probe
// GET /api/track/fingerprint?url=<stream>    -> identify what is playing right now

import { guardedFetch, readBodyCapped, rejectFetchUrl } from '../../_shared/guarded-fetch.js';
import { identifyTrack } from '../../../server/metadata-providers.mjs';

const USER_AGENT = 'EarthRadio/0.24.0 pages-fn (+https://github.com/Protonmatter/EarthRadio)';
const SAMPLE_SECONDS = 12;
const MIN_RECOGNIZE_BYTES = 16 * 1024;
const MIN_SAMPLE_BYTES = 96 * 1024;
const MAX_SAMPLE_BYTES = 1024 * 1024;
const DEFAULT_BITRATE_KBPS = 160;
const SAMPLE_TIMEOUT_MS = 20_000;
// One route-level budget shared by sampling, every recognition provider, and
// catalog enrichment; sampling alone is additionally capped at SAMPLE_TIMEOUT_MS
// so a slow live stream cannot consume the recognition stages' time.
const TOTAL_FINGERPRINT_BUDGET_MS = 40_000;
const RECOGNIZE_TIMEOUT_MS = 15_000;
const PLAYLIST_MAX_BYTES = 64 * 1024;
const HLS_SEGMENT_COUNT = 3;
const MAX_HLS_PLAYLIST_DEPTH = 2;
const HLS_FETCH_ATTEMPT_LIMIT = 16;
const DO_NOT_CACHE = Symbol('do-not-cache');
// Positive results must expire before the client's 30s retry cooldown: after a track
// change, a retry must sample the current audio, not replay the previous song.
const CACHE_TTL_FOUND_S = 25;
const CACHE_TTL_MISS_S = 30;

// The cached payload includes country-specific catalog enrichment, so the country is
// part of the cache identity; invalid or absent countries map to the US default key.
export function normalizeCountry(value) {
  const country = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : 'US';
}

export function fingerprintCacheKey(streamUrl, country) {
  return `https://cache.invalid/fingerprint?c=${normalizeCountry(country)}&u=${encodeURIComponent(String(streamUrl || '').trim())}`;
}

export async function onRequestGet({ request, env }) {
  const providers = configuredProviders(env);
  const url = new URL(request.url);
  const forbiddenOrigins = [url.origin];
  const streamUrl = String(url.searchParams.get('url') || '').trim().slice(0, 2000);
  if (!streamUrl) return json({ available: providers.length > 0, providers }, 60);
  if (!providers.length) return json({ available: false, found: false, reason: 'no fingerprint provider credentials configured' }, 300);

  const rejection = rejectFetchUrl(streamUrl, { forbiddenOrigins });
  if (rejection) return json({ available: true, found: false, reason: rejection }, CACHE_TTL_MISS_S, 400);

  const country = normalizeCountry(url.searchParams.get('country'));
  const cache = await openCache();
  const cacheKey = new Request(fingerprintCacheKey(streamUrl, country));
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const deadlineAt = Date.now() + TOTAL_FINGERPRINT_BUDGET_MS;
  const payload = await identify(streamUrl, providers, env, country, forbiddenOrigins, deadlineAt);
  const cacheable = !payload[DO_NOT_CACHE];
  const response = json(payload, cacheable ? (payload.found ? CACHE_TTL_FOUND_S : CACHE_TTL_MISS_S) : 0);
  if (cache && cacheable) await cache.put(cacheKey, response.clone()).catch(() => {});
  return response;
}

function configuredProviders(env = {}) {
  const providers = [];
  if (env.ACR_HOST && env.ACR_ACCESS_KEY && env.ACR_ACCESS_SECRET) providers.push('acrcloud');
  if (env.AUDD_API_TOKEN) providers.push('audd');
  return providers;
}

async function identify(streamUrl, providers, env, country, forbiddenOrigins, deadlineAt) {
  let sample;
  try {
    sample = await sampleStream(streamUrl, { deadlineAt: Math.min(deadlineAt, Date.now() + SAMPLE_TIMEOUT_MS), forbiddenOrigins });
  } catch (error) {
    const payload = { available: true, found: false, reason: `stream sampling failed: ${error?.message || 'unknown error'}` };
    if (isTerminalSamplingError(error)) Object.defineProperty(payload, DO_NOT_CACHE, { value: true });
    return payload;
  }
  if (!sample || sample.length < MIN_RECOGNIZE_BYTES) {
    return { available: true, found: false, reason: 'stream sample was too short to fingerprint' };
  }

  let match = null;
  let providerFailures = 0;
  for (const provider of providers) {
    try {
      match = provider === 'acrcloud'
        ? await withinDeadline(recognizeAcr(sample, env, deadlineAt), deadlineAt)
        : await withinDeadline(recognizeAudd(sample, env, deadlineAt), deadlineAt);
      if (match) break;
    } catch {
      // Transport/credential failure — try the next configured provider.
      providerFailures += 1;
    }
  }
  if (!match && providerFailures === providers.length) {
    // Recognition never completed; report an outage, not a negative identification.
    return { available: true, found: false, providerError: true, reason: 'fingerprint providers unavailable', sampleBytes: sample.length };
  }
  if (!match) return { available: true, found: false, reason: 'no fingerprint match', sampleBytes: sample.length };

  // Catalog enrichment for artwork/links; iTunes only — no server secrets required here.
  let catalog = { found: false };
  try {
    catalog = await withinDeadline(identifyTrack({
      artist: match.artist,
      title: match.title,
      providers: ['itunes'],
      country,
      deadlineAt
    }), deadlineAt);
  } catch { /* enrichment is optional */ }

  const confidence = Math.max(60, Math.min(98, Number(match.score) || 90));
  return {
    available: true,
    found: true,
    ...match,
    state: confidence >= 78 ? 'Identified' : 'Likely match',
    confidence,
    album: match.album || (catalog.found ? catalog.album : '') || '',
    releaseYear: match.releaseYear || (catalog.found ? catalog.releaseYear : '') || '',
    genre: catalog.found ? catalog.genre || '' : '',
    isrc: match.isrc || (catalog.found ? catalog.isrc : '') || '',
    artworkUrl: catalog.found ? catalog.artworkUrl || '' : '',
    previewUrl: catalog.found ? catalog.previewUrl || '' : '',
    appleMusicUrl: match.appleMusicUrl || (catalog.found ? catalog.appleMusicUrl : '') || '',
    spotifyUrl: match.spotifyUrl || (catalog.found ? catalog.spotifyUrl : '') || '',
    links: catalog.found ? catalog.links || {} : {},
    reasons: ['audio fingerprint match', ...(catalog.found ? ['catalog enrichment matched'] : [])],
    sources: [
      { provider: `fingerprint:${match.provider}`, confidence: confidence / 100, fetchedAt: new Date().toISOString() },
      ...(catalog.found ? (catalog.sources || []).filter(source => source.provider !== 'icy') : [])
    ],
    sampleBytes: sample.length,
    country,
    fetchedAt: new Date().toISOString()
  };
}

// ~12s of encoded audio through the guarded boundary; no Icy-MetaData header, so the
// bytes are pure audio. HLS playlists resolve one master hop then sample recent
// segments, all under the same wall-clock deadline.
export async function sampleStream(streamUrl, {
  deadlineAt = Date.now() + SAMPLE_TIMEOUT_MS,
  forbiddenOrigins = []
} = {}) {
  const attemptBudget = { remaining: HLS_FETCH_ATTEMPT_LIMIT };
  const { response, finalUrl } = await guardedFetch(streamUrl, {
    deadlineAt,
    forbiddenOrigins,
    attemptBudget,
    headers: { Accept: '*/*', 'User-Agent': USER_AGENT }
  });
  if (!response.ok || !response.body) {
    cancelResponseBody(response);
    throw new Error(`stream HTTP ${response.status}`);
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (/mpegurl/.test(contentType) || /\.m3u8(\?|#|$)/i.test(finalUrl)) {
    const playlist = new TextDecoder().decode(await readBodyCapped(response, { maxBytes: PLAYLIST_MAX_BYTES, deadlineAt }));
    return sampleHls(playlist, finalUrl, { deadlineAt, depth: 0, forbiddenOrigins, attemptBudget });
  }
  if (/text\/html|application\/json|text\/plain/.test(contentType)) {
    cancelResponseBody(response);
    throw new Error(`unsupported content-type ${contentType.split(';')[0] || 'unknown'}`);
  }

  const kbps = Number.parseInt(response.headers.get('icy-br') || '', 10);
  const bitrate = Number.isFinite(kbps) && kbps > 0 ? Math.min(kbps, 512) : DEFAULT_BITRATE_KBPS;
  const target = Math.min(MAX_SAMPLE_BYTES, Math.max(MIN_SAMPLE_BYTES, Math.round(bitrate * 1000 / 8 * SAMPLE_SECONDS)));
  return readBodyCapped(response, { maxBytes: target, deadlineAt });
}

async function sampleHls(playlistText, baseUrl, { deadlineAt, depth, forbiddenOrigins, attemptBudget }) {
  if (depth > MAX_HLS_PLAYLIST_DEPTH) throw new Error('HLS playlist nesting too deep');
  const lines = String(playlistText || '').split(/\r?\n/).map(line => line.trim());

  // Master playlist: follow the first variant, once, revalidated by the guard.
  if (playlistText.includes('#EXT-X-STREAM-INF')) {
    const variant = lines.find(line => line && !line.startsWith('#'));
    if (!variant) throw new Error('empty HLS master playlist');
    const variantUrl = new URL(variant, baseUrl).toString();
    const { response, finalUrl } = await guardedFetch(variantUrl, {
      deadlineAt,
      forbiddenOrigins,
      attemptBudget,
      headers: { Accept: '*/*', 'User-Agent': USER_AGENT }
    });
    if (!response.ok) {
      cancelResponseBody(response);
      throw new Error(`HLS playlist HTTP ${response.status}`);
    }
    const media = new TextDecoder().decode(await readBodyCapped(response, { maxBytes: PLAYLIST_MAX_BYTES, deadlineAt }));
    return sampleHls(media, finalUrl, { deadlineAt, depth: depth + 1, forbiddenOrigins, attemptBudget });
  }

  const { segments, map, encrypted } = coherentHlsTail(lines);
  if (!segments.length) throw new Error('HLS media playlist has no segments');
  // Encrypted segments would reach the recognizers as ciphertext and spend metered
  // recognition quota on a guaranteed no-match; refuse before fetching anything.
  if (encrypted) throw new Error('encrypted HLS stream not supported for fingerprinting');
  // Fragmented-MP4 playlists carry decoder metadata in an EXT-X-MAP initialization
  // segment. A map governs the segments after it, so a transition inside the recent
  // window narrows sampling to the coherent suffix governed by the newest map.
  const fetchList = map ? [{ ...map, initialization: true }, ...segments] : segments;
  const perSegmentCap = Math.floor(MAX_SAMPLE_BYTES / fetchList.length);
  const parts = [];
  let total = 0;
  for (const segment of fetchList) {
    if (Date.now() >= deadlineAt) throw new Error('request deadline exceeded');
    try {
      const headers = { Accept: '*/*', 'User-Agent': USER_AGENT };
      // Byte-ranged playlists address fragments inside one shared resource; without
      // the Range header every request returns the beginning of that resource.
      if (segment.range) headers.Range = `bytes=${segment.range.offset}-${segment.range.offset + segment.range.length - 1}`;
      const { response } = await guardedFetch(new URL(segment.uri, baseUrl).toString(), {
        deadlineAt,
        forbiddenOrigins,
        attemptBudget,
        headers
      });
      if (!response.ok || !response.body) {
        cancelResponseBody(response);
        if (segment.initialization) throw new Error('HLS initialization segment could not be fetched');
        continue;
      }
      const bytes = await readBodyCapped(response, { maxBytes: perSegmentCap, deadlineAt });
      if (bytes.length) {
        parts.push(bytes);
        total += bytes.length;
      } else if (segment.initialization) {
        throw new Error('HLS initialization segment could not be fetched');
      }
    } catch (error) {
      // Fragments without their EXT-X-MAP metadata are undecodable; submitting them
      // would spend recognition quota on a predictable miss.
      if (isTerminalSamplingError(error) || segment.initialization) throw error;
      // A missing segment is non-terminal; other recent segments may still provide
      // a complete bounded sample.
    }
  }
  if (!parts.length) throw new Error('no HLS segments could be fetched');
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function coherentHlsTail(lines) {
  let activeMap = null;
  let keyMethod = 'NONE';
  let pendingRange = null;
  let previous = null;
  const media = [];
  for (const line of lines) {
    const mapMatch = line.match(/^#EXT-X-MAP:.*URI="([^"]+)"/i);
    if (mapMatch) {
      const mapRange = line.match(/BYTERANGE="(\d+)@(\d+)"/i);
      activeMap = {
        uri: mapMatch[1],
        range: mapRange ? { offset: Number(mapRange[2]), length: Number(mapRange[1]) } : null
      };
      continue;
    }
    const declaredMethod = line.match(/^#EXT-X-KEY:.*METHOD=([\w-]+)/i)?.[1];
    if (declaredMethod) {
      keyMethod = declaredMethod.toUpperCase();
      continue;
    }
    const rangeMatch = line.match(/^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/i);
    if (rangeMatch) {
      pendingRange = { length: Number(rangeMatch[1]), offset: rangeMatch[2] === undefined ? null : Number(rangeMatch[2]) };
      continue;
    }
    if (line && !line.startsWith('#')) {
      let range = null;
      if (pendingRange) {
        // An offset-less BYTERANGE continues at the end of the previous sub-range
        // of the same resource (RFC 8216 §4.3.2.2).
        const offset = pendingRange.offset ?? (previous?.uri === line && previous.range
          ? previous.range.offset + previous.range.length
          : 0);
        range = { offset, length: pendingRange.length };
        pendingRange = null;
      }
      const segment = { uri: line, map: activeMap, range, encrypted: keyMethod !== 'NONE' };
      media.push(segment);
      previous = segment;
    }
  }

  const recent = media.slice(-HLS_SEGMENT_COUNT);
  if (!recent.length) return { segments: [], map: null, encrypted: false };
  const map = recent.at(-1).map;
  let coherentStart = recent.length - 1;
  while (coherentStart > 0 && recent[coherentStart - 1].map === map) coherentStart -= 1;
  const segments = recent.slice(coherentStart);
  return {
    segments: segments.map(({ uri, range }) => ({ uri, range })),
    map,
    encrypted: segments.some(segment => segment.encrypted)
  };
}

function isTerminalSamplingError(error) {
  return error?.code === 'ERR_FETCH_ATTEMPT_LIMIT' || /deadline/i.test(String(error?.message || ''));
}

async function recognizeAcr(sample, env, deadlineAt) {
  const host = String(env.ACR_HOST || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const timestamp = Math.floor(Date.now() / 1000);
  const stringToSign = ['POST', '/v1/identify', env.ACR_ACCESS_KEY, 'audio', '1', String(timestamp)].join('\n');
  const signature = await hmacSha1Base64(env.ACR_ACCESS_SECRET, stringToSign);

  const form = new FormData();
  form.set('access_key', env.ACR_ACCESS_KEY);
  form.set('data_type', 'audio');
  form.set('signature_version', '1');
  form.set('timestamp', String(timestamp));
  form.set('signature', signature);
  form.set('sample_bytes', String(sample.length));
  form.set('sample', new Blob([sample]), 'sample.bin');

  const outcome = await postForm(`https://${host}/v1/identify`, form, deadlineAt);
  if (!outcome.ok) throw new Error('acrcloud request failed');
  const code = Number(outcome.data?.status?.code);
  if (code !== 0 && code !== 1001) throw new Error(`acrcloud status ${code}`);
  const data = outcome.data;
  if (code !== 0) return null;
  const music = data?.metadata?.music?.[0];
  if (!music?.title) return null;
  const spotifyId = music.external_metadata?.spotify?.track?.id || '';
  return {
    provider: 'acrcloud',
    artist: (music.artists || []).map(item => item?.name).filter(Boolean).join(', '),
    title: String(music.title || ''),
    album: String(music.album?.name || ''),
    releaseYear: String(music.release_date || '').slice(0, 4),
    isrc: String(music.external_ids?.isrc || ''),
    score: Math.round(Number(music.score) || 0),
    spotifyUrl: spotifyId ? `https://open.spotify.com/track/${spotifyId}` : '',
    appleMusicUrl: ''
  };
}

async function recognizeAudd(sample, env, deadlineAt) {
  const form = new FormData();
  form.set('api_token', env.AUDD_API_TOKEN);
  form.set('return', 'apple_music,spotify');
  form.set('file', new Blob([sample]), 'sample.bin');

  const outcome = await postForm('https://api.audd.io/', form, deadlineAt);
  if (!outcome.ok) throw new Error('audd request failed');
  if (outcome.data?.status !== 'success') throw new Error(`audd status ${outcome.data?.status || 'unknown'}`);
  if (!outcome.data?.result?.title) return null;
  const result = outcome.data.result;
  return {
    provider: 'audd',
    artist: String(result.artist || ''),
    title: String(result.title || ''),
    album: String(result.album || ''),
    releaseYear: String(result.release_date || '').slice(0, 4),
    isrc: String(result.apple_music?.isrc || result.spotify?.external_ids?.isrc || ''),
    score: 90,
    spotifyUrl: String(result.spotify?.external_urls?.spotify || ''),
    appleMusicUrl: String(result.apple_music?.url || '')
  };
}

async function hmacSha1Base64(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function postForm(target, form, deadlineAt = Date.now() + RECOGNIZE_TIMEOUT_MS) {
  const remaining = Math.min(RECOGNIZE_TIMEOUT_MS, deadlineAt - Date.now());
  if (remaining <= 0) return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(target, { method: 'POST', signal: controller.signal, body: form, headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) {
      cancelResponseBody(response);
      return { ok: false };
    }
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function withinDeadline(promise, deadlineAt) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return Promise.reject(new Error('fingerprint deadline exceeded'));
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('fingerprint deadline exceeded')), remaining);
    })
  ]).finally(() => clearTimeout(timer));
}

async function openCache() {
  try {
    return globalThis.caches?.default || (globalThis.caches?.open ? await globalThis.caches.open('earth-radio-fingerprint') : null);
  } catch {
    return null;
  }
}

function cancelResponseBody(response) {
  response?.body?.cancel?.().catch?.(() => {});
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
