// Example integration for the existing Earth Radio proxy/server.
// Import `handleTrackIdentify` and mount it before your static file handler.

import { identifyTrack } from './metadata-providers.mjs';

const ALLOWED_PROVIDERS = new Set(['itunes', 'spotify']);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const rateBuckets = new Map();

export async function handleTrackIdentify(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/track/identify') return false;
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'method not allowed' });
  }
  if (!consumeRateLimit(req)) {
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

function consumeRateLimit(req) {
  const key = req.socket?.remoteAddress || 'local';
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX_REQUESTS;
}
