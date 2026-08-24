// Cloudflare Pages Function: on-demand audio fingerprinting for the public web app.
// Mirrors the desktop proxy's /api/track/fingerprint contract. Strictly opt-in: without
// ACRCloud (ACR_HOST/ACR_ACCESS_KEY/ACR_ACCESS_SECRET) or AudD (AUDD_API_TOKEN)
// environment variables configured on the Pages project, every request reports
// available: false and the client hides the identify button. Recognition is metered,
// so results are edge-cached per stream URL and requests are rate-limited per client.
//
// GET /api/track/fingerprint                 -> availability probe
// GET /api/track/fingerprint?url=<stream>    -> identify what is playing right now

import { rejectStreamUrl } from '../nowplaying.js';
import { identifyTrack } from '../../../server/metadata-providers.mjs';

const USER_AGENT = 'EarthRadio/0.24.0 pages-fn (+https://github.com/Protonmatter/EarthRadio)';
const SAMPLE_SECONDS = 12;
const MIN_RECOGNIZE_BYTES = 16 * 1024;
const MIN_SAMPLE_BYTES = 96 * 1024;
const MAX_SAMPLE_BYTES = 1024 * 1024;
const DEFAULT_BITRATE_KBPS = 160;
const SAMPLE_TIMEOUT_MS = 20_000;
const RECOGNIZE_TIMEOUT_MS = 15_000;
const CACHE_TTL_FOUND_S = 90;
const CACHE_TTL_MISS_S = 45;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 6;

// Per-isolate best-effort limiter; the edge cache above it absorbs repeats.
const rateBuckets = new Map();

export async function onRequestGet({ request, env }) {
  const providers = configuredProviders(env);
  const url = new URL(request.url);
  const streamUrl = String(url.searchParams.get('url') || '').trim().slice(0, 2000);
  if (!streamUrl) return json({ available: providers.length > 0, providers }, 60);
  if (!providers.length) return json({ available: false, found: false, reason: 'no fingerprint provider credentials configured' }, 300);

  const rejection = rejectStreamUrl(streamUrl);
  if (rejection) return json({ available: true, found: false, reason: rejection }, CACHE_TTL_MISS_S, 400);

  const cache = await openCache();
  const cacheKey = new Request(`https://cache.invalid/fingerprint?u=${encodeURIComponent(streamUrl)}`);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  if (!consumeRateLimit(request)) {
    return json({ error: 'fingerprint rate limit exceeded' }, 0, 429);
  }

  const payload = await identify(streamUrl, providers, env, url.searchParams.get('country') || 'US');
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

async function identify(streamUrl, providers, env, country) {
  let sample;
  try {
    sample = await sampleStream(streamUrl);
  } catch (error) {
    return { available: true, found: false, reason: `stream sampling failed: ${error?.message || 'unknown error'}` };
  }
  if (!sample || sample.length < MIN_RECOGNIZE_BYTES) {
    return { available: true, found: false, reason: 'stream sample was too short to fingerprint' };
  }

  let match = null;
  for (const provider of providers) {
    try {
      match = provider === 'acrcloud' ? await recognizeAcr(sample, env) : await recognizeAudd(sample, env);
      if (match) break;
    } catch { /* next provider */ }
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
    fetchedAt: new Date().toISOString()
  };
}

// ~12s of encoded audio, target size derived from icy-br; no Icy-MetaData header, so
// the bytes are pure audio.
async function sampleStream(streamUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAMPLE_TIMEOUT_MS);
  try {
    const response = await fetch(streamUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: '*/*', 'User-Agent': USER_AGENT }
    });
    if (!response.ok || !response.body) throw new Error(`stream HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (/text\/html|application\/json|text\/plain|mpegurl/.test(contentType)) {
      throw new Error(`unsupported content-type ${contentType.split(';')[0] || 'unknown'}`);
    }
    const kbps = Number.parseInt(response.headers.get('icy-br') || '', 10);
    const bitrate = Number.isFinite(kbps) && kbps > 0 ? Math.min(kbps, 512) : DEFAULT_BITRATE_KBPS;
    const target = Math.min(MAX_SAMPLE_BYTES, Math.max(MIN_SAMPLE_BYTES, Math.round(bitrate * 1000 / 8 * SAMPLE_SECONDS)));

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (received < target) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function recognizeAcr(sample, env) {
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

  const data = await postForm(`https://${host}/v1/identify`, form);
  if (Number(data?.status?.code) !== 0) return null;
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

async function recognizeAudd(sample, env) {
  const form = new FormData();
  form.set('api_token', env.AUDD_API_TOKEN);
  form.set('return', 'apple_music,spotify');
  form.set('file', new Blob([sample]), 'sample.bin');

  const data = await postForm('https://api.audd.io/', form);
  if (data?.status !== 'success' || !data?.result?.title) return null;
  const result = data.result;
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

async function postForm(target, form) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECOGNIZE_TIMEOUT_MS);
  try {
    const response = await fetch(target, { method: 'POST', signal: controller.signal, body: form, headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function consumeRateLimit(request) {
  const key = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  if (rateBuckets.size > 512) {
    for (const [bucketKey, entry] of rateBuckets) {
      if (now >= entry.resetAt) rateBuckets.delete(bucketKey);
    }
  }
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
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
