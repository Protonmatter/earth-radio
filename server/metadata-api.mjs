// Example integration for the existing Earth Radio proxy/server.
// Import `handleMetadataApi` and mount it before your static file handler.

import { identifyTrack } from './metadata-providers.mjs';
import { resolvePlatformNowPlaying } from './platform-nowplaying.mjs';
import { fingerprintAvailable, fingerprintProviders, identifyByFingerprint } from './fingerprint-providers.mjs';

const ALLOWED_PROVIDERS = new Set(['itunes', 'spotify']);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
// Fingerprint recognition is metered per request on the provider side, so its
// budget is far tighter than the free catalog lookups.
const FINGERPRINT_RATE_LIMIT_MAX_REQUESTS = 10;
const rateBuckets = new Map();
const fingerprintRateBuckets = new Map();

// Routes every metadata API path; returns false when the request is not ours.
export async function handleMetadataApi(req, res) {
  if (await handleTrackIdentify(req, res)) return true;
  if (await handlePlatformNowPlaying(req, res)) return true;
  if (await handleTrackFingerprint(req, res)) return true;
  return false;
}

export async function handlePlatformNowPlaying(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/streams/platform-nowplaying') return false;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
  if (!consumeRateLimit(req, rateBuckets, RATE_LIMIT_MAX_REQUESTS)) {
    return sendJson(res, 429, { error: 'rate limit exceeded' }, { 'retry-after': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
  }
  const streamUrl = boundedParam(url.searchParams.get('url'), 2000);
  if (!streamUrl) return sendJson(res, 400, { error: 'missing stream url' });
  try {
    const payload = await resolvePlatformNowPlaying(streamUrl);
    return sendJson(res, 200, payload, { 'cache-control': payload.found ? 'public, max-age=15' : 'public, max-age=120' });
  } catch (error) {
    return sendJson(res, 400, { error: error?.message || 'platform now-playing failed' });
  }
}

export async function handleTrackFingerprint(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/track/fingerprint') return false;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  const streamUrl = boundedParam(url.searchParams.get('url'), 2000);
  if (!streamUrl) {
    // Availability probe: lets the client decide whether to render the identify button.
    return sendJson(res, 200, { available: fingerprintAvailable(), providers: fingerprintProviders() });
  }
  if (!fingerprintAvailable()) {
    return sendJson(res, 200, { available: false, found: false, reason: 'no fingerprint provider credentials configured' });
  }
  if (!consumeRateLimit(req, fingerprintRateBuckets, FINGERPRINT_RATE_LIMIT_MAX_REQUESTS)) {
    return sendJson(res, 429, { error: 'fingerprint rate limit exceeded' }, { 'retry-after': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
  }

  try {
    const fingerprint = await identifyByFingerprint({ streamUrl });
    if (!fingerprint.found) return sendJson(res, 200, fingerprint);

    // Enrich the fingerprint hit with catalog artwork/links through the existing
    // identify pipeline; the fingerprint identity itself stays authoritative.
    const catalog = await identifyTrack({
      artist: fingerprint.artist,
      title: fingerprint.title,
      country: sanitizeCountry(url.searchParams.get('country') || 'US')
    });
    const confidence = Math.max(60, Math.min(98, Number(fingerprint.score) || 90));
    return sendJson(res, 200, {
      ...fingerprint,
      state: confidence >= 78 ? 'Identified' : 'Likely match',
      confidence,
      album: fingerprint.album || catalog.album || '',
      releaseYear: fingerprint.releaseYear || catalog.releaseYear || '',
      genre: catalog.genre || '',
      isrc: fingerprint.isrc || catalog.isrc || '',
      artworkUrl: catalog.found ? catalog.artworkUrl || '' : '',
      previewUrl: catalog.found ? catalog.previewUrl || '' : '',
      spotifyUrl: fingerprint.spotifyUrl || (catalog.found ? catalog.spotifyUrl || '' : ''),
      appleMusicUrl: fingerprint.appleMusicUrl || (catalog.found ? catalog.appleMusicUrl || '' : ''),
      links: catalog.links || {},
      reasons: ['audio fingerprint match', ...(catalog.found ? ['catalog enrichment matched'] : [])],
      sources: [
        { provider: `fingerprint:${fingerprint.provider}`, confidence: confidence / 100, fetchedAt: fingerprint.fetchedAt },
        ...(catalog.found ? (catalog.sources || []).filter(source => source.provider !== 'icy') : [])
      ]
    });
  } catch (error) {
    return sendJson(res, 400, { error: error?.message || 'fingerprint failed' });
  }
}

export async function handleTrackIdentify(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/track/identify') return false;
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'method not allowed' });
  }
  if (!consumeRateLimit(req, rateBuckets, RATE_LIMIT_MAX_REQUESTS)) {
    return sendJson(res, 429, { error: 'rate limit exceeded' }, { 'retry-after': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
  }

  const providers = String(url.searchParams.get('providers') || 'itunes,spotify')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(item => ALLOWED_PROVIDERS.has(item));
  const payload = await identifyTrack({
    artist: boundedParam(url.searchParams.get('artist'), 200),
    title: boundedParam(url.searchParams.get('title'), 200),
    raw: boundedParam(url.searchParams.get('raw'), 500),
    country: sanitizeCountry(url.searchParams.get('country') || 'US'),
    providers
  });

  return sendJson(res, 200, payload, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': payload.found ? 'public, max-age=86400' : 'public, max-age=900'
  });
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
  return true;
}

function boundedParam(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

function sanitizeCountry(value) {
  const country = String(value || 'US').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : 'US';
}

function consumeRateLimit(req, buckets, maxRequests) {
  const key = req.socket?.remoteAddress || 'local';
  const now = Date.now();
  if (buckets.size > 512) {
    for (const [bucketKey, entry] of buckets) {
      if (now >= entry.resetAt) buckets.delete(bucketKey);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= maxRequests;
}
