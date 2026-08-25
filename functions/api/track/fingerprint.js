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
import { parseMapSegment, parseMediaSegments, rangeHeaderFor } from '../../../server/hls-segments.mjs';

const USER_AGENT = 'EarthRadio/0.24.0 pages-fn (+https://github.com/Protonmatter/EarthRadio)';
const SAMPLE_SECONDS = 12;
const MIN_RECOGNIZE_BYTES = 16 * 1024;
const MIN_SAMPLE_BYTES = 96 * 1024;
const MAX_SAMPLE_BYTES = 1024 * 1024;
const DEFAULT_BITRATE_KBPS = 160;
const SAMPLE_TIMEOUT_MS = 20_000;
// One budget for the whole request (sampling + every provider): the browser aborts
// at 45s, so the route must always answer inside that.
const TOTAL_FINGERPRINT_BUDGET_MS = 40_000;
const RECOGNIZE_TIMEOUT_MS = 15_000;
const PLAYLIST_MAX_BYTES = 64 * 1024;
const HLS_SEGMENT_COUNT = 3;
const MAX_HLS_PLAYLIST_DEPTH = 2;
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
  const streamUrl = String(url.searchParams.get('url') || '').trim().slice(0, 2000);
  if (!streamUrl) return json({ available: providers.length > 0, providers }, 60);
  if (!providers.length) return json({ available: false, found: false, reason: 'no fingerprint provider credentials configured' }, 300);

  // This deployment's own hostname is never a valid stream target (same-zone block).
  const forbiddenOrigins = [url.origin];
  const rejection = rejectFetchUrl(streamUrl, { forbiddenOrigins });
  if (rejection) return json({ available: true, found: false, reason: rejection }, CACHE_TTL_MISS_S, 400);

  const country = normalizeCountry(url.searchParams.get('country'));
  const cache = await openCache();
  const cacheKey = new Request(fingerprintCacheKey(streamUrl, country));
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const payload = await identify(streamUrl, providers, env, country, forbiddenOrigins);
  const response = json(payload, payload.found ? CACHE_TTL_FOUND_S : CACHE_TTL_MISS_S);
  if (cache) await cache.put(cacheKey, response.clone()).catch(() => {});
  return response;
}

function configuredProviders(env = {}) {
  const providers = [];
  if (env.ACR_HOST && env.ACR_ACCESS_KEY && env.ACR_ACCESS_SECRET) providers.push('acrcloud');
  if (env.AUDD_API_TOKEN) providers.push('audd');
  return providers;
}

export async function identify(streamUrl, providers, env, country, forbiddenOrigins = [], { budgetMs = TOTAL_FINGERPRINT_BUDGET_MS } = {}) {
  const deadlineAt = Date.now() + budgetMs;
  let sample;
  try {
    sample = await sampleStream(streamUrl, forbiddenOrigins, deadlineAt);
  } catch (error) {
    return { available: true, found: false, reason: `stream sampling failed: ${error?.message || 'unknown error'}` };
  }
  if (!sample || sample.length < MIN_RECOGNIZE_BYTES) {
    return { available: true, found: false, reason: 'stream sample was too short to fingerprint' };
  }

  let match = null;
  let providerFailures = 0;
  for (const provider of providers) {
    // Recognition shares the route budget with sampling: a stalled first provider
    // must leave the next one only the remaining time, never a fresh full timeout.
    const remaining = deadlineAt - Date.now();
    if (remaining < 3000) {
      providerFailures += 1;
      continue;
    }
    const providerTimeoutMs = Math.min(RECOGNIZE_TIMEOUT_MS, remaining);
    try {
      match = provider === 'acrcloud'
        ? await recognizeAcr(sample, env, providerTimeoutMs)
        : await recognizeAudd(sample, env, providerTimeoutMs);
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
    catalog = await identifyTrack({ artist: match.artist, title: match.title, providers: ['itunes'], country });
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
async function sampleStream(streamUrl, forbiddenOrigins = [], overallDeadlineAt = 0) {
  const deadlineAt = overallDeadlineAt > 0
    ? Math.min(Date.now() + SAMPLE_TIMEOUT_MS, overallDeadlineAt)
    : Date.now() + SAMPLE_TIMEOUT_MS;
  const { response, finalUrl } = await guardedFetch(streamUrl, {
    deadlineAt,
    forbiddenOrigins,
    headers: { Accept: '*/*', 'User-Agent': USER_AGENT }
  });
  if (!response.ok || !response.body) throw new Error(`stream HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (/mpegurl/.test(contentType) || /\.m3u8(\?|#|$)/i.test(finalUrl)) {
    const playlist = new TextDecoder().decode(await readBodyCapped(response, { maxBytes: PLAYLIST_MAX_BYTES, deadlineAt }));
    return sampleHls(playlist, finalUrl, { deadlineAt, depth: 0, forbiddenOrigins });
  }
  if (/text\/html|application\/json|text\/plain/.test(contentType)) {
    throw new Error(`unsupported content-type ${contentType.split(';')[0] || 'unknown'}`);
  }

  const kbps = Number.parseInt(response.headers.get('icy-br') || '', 10);
  const bitrate = Number.isFinite(kbps) && kbps > 0 ? Math.min(kbps, 512) : DEFAULT_BITRATE_KBPS;
  const target = Math.min(MAX_SAMPLE_BYTES, Math.max(MIN_SAMPLE_BYTES, Math.round(bitrate * 1000 / 8 * SAMPLE_SECONDS)));
  return readBodyCapped(response, { maxBytes: target, deadlineAt });
}

async function sampleHls(playlistText, baseUrl, { deadlineAt, depth, forbiddenOrigins = [] }) {
  if (depth > MAX_HLS_PLAYLIST_DEPTH) throw new Error('HLS playlist nesting too deep');
  const lines = String(playlistText || '').split(/\r?\n/).map(line => line.trim());

  // Master playlist: follow the first variant, once, revalidated by the guard.
  if (playlistText.includes('#EXT-X-STREAM-INF')) {
    const variant = lines.find(line => line && !line.startsWith('#'));
    if (!variant) throw new Error('empty HLS master playlist');
    const variantUrl = new URL(variant, baseUrl).toString();
    const { response, finalUrl } = await guardedFetch(variantUrl, { deadlineAt, forbiddenOrigins, headers: { Accept: '*/*', 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`HLS playlist HTTP ${response.status}`);
    const media = new TextDecoder().decode(await readBodyCapped(response, { maxBytes: PLAYLIST_MAX_BYTES, deadlineAt }));
    return sampleHls(media, finalUrl, { deadlineAt, depth: depth + 1, forbiddenOrigins });
  }

  const segments = parseMediaSegments(lines).slice(-HLS_SEGMENT_COUNT);
  if (!segments.length) throw new Error('HLS media playlist has no segments');
  // Fragmented-MP4 playlists carry decoder metadata in an EXT-X-MAP initialization
  // segment; without it the recognizers receive an undecodable container. Byte-range
  // playlists (#EXT-X-BYTERANGE) address fragments inside one file; the parsed range
  // becomes a Range header so repeated URIs fetch distinct fragments.
  const fetchList = [...parseMapSegment(lines), ...segments];
  const perSegmentCap = Math.floor(MAX_SAMPLE_BYTES / fetchList.length);
  const parts = [];
  let total = 0;
  for (const segment of fetchList) {
    if (Date.now() >= deadlineAt) break;
    try {
      const headers = { Accept: '*/*', 'User-Agent': USER_AGENT };
      const rangeHeader = rangeHeaderFor(segment);
      if (rangeHeader) headers.Range = rangeHeader;
      const { response } = await guardedFetch(new URL(segment.uri, baseUrl).toString(), { deadlineAt, forbiddenOrigins, headers });
      if (!response.ok || !response.body) continue;
      const bytes = await readBodyCapped(response, { maxBytes: perSegmentCap, deadlineAt });
      if (bytes.length) {
        parts.push(bytes);
        total += bytes.length;
      }
    } catch { /* skip unreachable segment */ }
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

async function recognizeAcr(sample, env, timeoutMs = RECOGNIZE_TIMEOUT_MS) {
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

  const outcome = await postForm(`https://${host}/v1/identify`, form, timeoutMs);
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

async function recognizeAudd(sample, env, timeoutMs = RECOGNIZE_TIMEOUT_MS) {
  const form = new FormData();
  form.set('api_token', env.AUDD_API_TOKEN);
  form.set('return', 'apple_music,spotify');
  form.set('file', new Blob([sample]), 'sample.bin');

  const outcome = await postForm('https://api.audd.io/', form, timeoutMs);
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

async function postForm(target, form, timeoutMs = RECOGNIZE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, { method: 'POST', signal: controller.signal, body: form, headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return { ok: false };
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function openCache() {
  try {
    return globalThis.caches?.default || (globalThis.caches?.open ? await globalThis.caches.open('earth-radio-fingerprint') : null);
  } catch {
    return null;
  }
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
