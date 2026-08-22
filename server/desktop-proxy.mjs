// Earth Radio desktop local proxy v0.24.0
// Routes the packaged Electron renderer through a loopback API for directory, stream, and metadata enrichment.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { URL, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { handleTrackIdentify } from './metadata-api.mjs';

const USER_AGENT = 'EarthRadio/0.24.0 desktop-proxy (+https://github.com/Protonmatter/EarthRadio)';
const RADIO_BROWSER_BASES = [
  'https://all.api.radio-browser.info',
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info'
];
const DIRECTORY_CACHE_TTL_MS = 10 * 60 * 1000;
const STREAM_TIMEOUT_MS = 8000;
const MAX_PLAYLIST_BYTES = 64 * 1024;
const MAX_PROBE_BYTES = 4096;
const FEATURED_COUNTRY_CODES = Object.freeze(['KR', 'US', 'GB', 'NL', 'FR', 'DE', 'CA']);
const FEATURED_COUNTRY_LIMIT = 300;
const MAX_FEATURED_COUNTRY_CODES = 20;
const MAX_FEDERATED_STATIONS = 6500;
const MAX_DIRECTORY_CACHE_ENTRIES = 24;
const UTF8_METADATA_DECODER = new TextDecoder('utf-8', { fatal: true });
const WINDOWS_1252_METADATA_DECODER = new TextDecoder('windows-1252');

const directoryCache = new Map();

export async function createDesktopProxy({ port = 0, host = '127.0.0.1' } = {}) {
  const server = http.createServer((req, res) => {
    void route(req, res).catch(error => sendRouteError(res, error));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const baseUrl = `http://${host}:${actualPort}`;
  console.log(`Earth Radio desktop proxy listening on ${baseUrl}`);

  return {
    server,
    baseUrl,
    close: () => new Promise(resolve => server.close(() => resolve()))
  };
}

async function route(req, res) {
  if (!applyCors(req, res)) return sendJson(res, 403, { error: 'origin not allowed' });
  if (req.method === 'OPTIONS') return res.end();

  const url = new URL(req.url || '/', 'http://localhost');
  if (await handleTrackIdentify(req, res)) return;

  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  if (url.pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, service: 'earth-radio-desktop-proxy', version: '0.24.0', time: new Date().toISOString() });
  }

  if (url.pathname === '/api/stations/federated' || url.pathname === '/api/stations/top') {
    const limit = clampInt(url.searchParams.get('limit'), 1000, 50, 5000);
    const countryCodes = parseCountryCodes(url.searchParams.get('countries'), FEATURED_COUNTRY_CODES);
    const countryLimit = clampInt(url.searchParams.get('countryLimit'), FEATURED_COUNTRY_LIMIT, 25, 1000);
    return sendJson(res, 200, await getStations(limit, countryCodes, countryLimit));
  }

  const clickMatch = url.pathname.match(/^\/api\/stations\/click\/(.+)$/);
  if (clickMatch) {
    const uuid = decodeURIComponent(clickMatch[1] || '').replace(/[^a-zA-Z0-9-]/g, '');
    if (!uuid) return sendJson(res, 400, { error: 'missing station uuid' });
    return sendJson(res, 200, await recordClick(uuid));
  }

  if (url.pathname === '/api/streams/resolve') {
    const streamTarget = await resolvePublicTarget(url.searchParams.get('url') || '');
    return sendJson(res, 200, await resolveStream(streamTarget));
  }

  if (url.pathname === '/api/streams/probe') {
    const streamTarget = await resolvePublicTarget(url.searchParams.get('url') || '');
    return sendJson(res, 200, await probeStream(streamTarget));
  }

  if (url.pathname === '/api/streams/nowplaying') {
    const streamTarget = await resolvePublicTarget(url.searchParams.get('url') || '');
    return streamNowPlayingSse(req, res, streamTarget);
  }

  if (url.pathname === '/api/geo/country') {
    return sendJson(res, 200, { found: false, reason: 'country-facts provider not bundled in desktop proxy' });
  }

  return sendJson(res, 404, { error: 'not found' });
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = allowedCorsOrigin(origin);
  if (origin && !allowedOrigin) return false;
  if (allowedOrigin) res.setHeader('access-control-allow-origin', allowedOrigin);
  res.setHeader('access-control-allow-methods', 'GET,OPTIONS');
  res.setHeader('access-control-allow-headers', 'accept,content-type');
  res.setHeader('vary', 'origin');
  return true;
}

function allowedCorsOrigin(origin) {
  if (!origin) return '';
  if (origin === 'null') return 'null';
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === 'file:') return origin;
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && isLoopbackHost(parsed.hostname)) return origin;
  } catch {
    return '';
  }
  return '';
}

async function getStations(limit, requestedCountryCodes = FEATURED_COUNTRY_CODES, countryLimit = FEATURED_COUNTRY_LIMIT) {
  const countryCodes = parseCountryCodes(requestedCountryCodes, FEATURED_COUNTRY_CODES);
  const maxStations = Math.min(MAX_FEDERATED_STATIONS, limit + countryCodes.length * countryLimit);
  const cacheKey = `federated:${limit}:${countryLimit}:${countryCodes.join(',')}`;
  const cached = directoryCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < DIRECTORY_CACHE_TTL_MS) return { ...cached.payload, cached: true };

  const errors = [];
  for (const base of RADIO_BROWSER_BASES) {
    try {
      const directory = await fetchRadioBrowserDirectory(base, limit, countryCodes, countryLimit);
      const stations = mergeStationRecords(directory.stations).slice(0, maxStations);
      if (!stations.length) throw new Error('empty station response');
      const payload = {
        source: 'desktop-proxy:federated',
        mode: 'radio-browser-country-targeted',
        countryCodes,
        countryLimit,
        sources: [{
          source: 'radio-browser',
          stationCount: stations.length,
          confidence: 0.85,
          endpoints: directory.endpointCounts,
          errors: directory.errors
        }],
        generatedAt: new Date().toISOString(),
        stations
      };
      setDirectoryCache(cacheKey, payload);
      return payload;
    } catch (error) {
      errors.push(`${base}: ${error?.message || error}`);
    }
  }
  throw new Error(`station directory unavailable: ${errors.join(' | ')}`);
}

function setDirectoryCache(cacheKey, payload) {
  directoryCache.set(cacheKey, { savedAt: Date.now(), payload });
  while (directoryCache.size > MAX_DIRECTORY_CACHE_ENTRIES) {
    const oldestKey = directoryCache.keys().next().value;
    if (!oldestKey) break;
    directoryCache.delete(oldestKey);
  }
}

async function fetchRadioBrowserDirectory(base, limit, countryCodes, countryLimit) {
  const endpoints = [
    {
      id: 'topclick',
      label: 'global top-click',
      confidence: 0.85,
      url: `${base}/json/stations/topclick/${encodeURIComponent(String(limit))}?hidebroken=true`
    },
    ...countryCodes.map(code => ({
      id: `country:${code}`,
      label: `country ${code}`,
      countryCode: code,
      confidence: 0.82,
      url: radioBrowserCountrySearchUrl(base, code, countryLimit)
    }))
  ];

  const observedAt = new Date().toISOString();
  const settled = await Promise.allSettled(endpoints.map(endpoint => fetchJson(endpoint.url, 60_000)));
  const stations = [];
  const endpointCounts = [];
  const errors = [];

  settled.forEach((result, index) => {
    const endpoint = endpoints[index];
    if (result.status !== 'fulfilled') {
      errors.push(`${endpoint.id}: ${result.reason?.message || result.reason || 'request failed'}`);
      return;
    }

    if (!Array.isArray(result.value)) {
      errors.push(`${endpoint.id}: invalid station response shape`);
      return;
    }

    endpointCounts.push({ id: endpoint.id, label: endpoint.label, stationCount: result.value.length });
    for (const station of result.value) {
      stations.push(addRadioBrowserSourceClaim(station, endpoint, observedAt));
    }
  });

  if (!stations.length) throw new Error(`no station records returned by ${base}: ${errors.join(' | ')}`);
  return { stations, endpointCounts, errors };
}

function radioBrowserCountrySearchUrl(base, countryCode, limit) {
  const params = new URLSearchParams({
    countrycode: countryCode,
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
    limit: String(limit)
  });
  return `${base}/json/stations/search?${params.toString()}`;
}

function addRadioBrowserSourceClaim(station, endpoint, observedAt) {
  return {
    ...station,
    sourceClaims: mergeSourceClaims(station?.sourceClaims, [{
      source: 'radio-browser',
      confidence: endpoint.confidence,
      method: endpoint.id,
      lastSeenAt: observedAt
    }])
  };
}

function mergeStationRecords(stations) {
  const byId = new Map();
  for (const station of stations) {
    const key = stationRecordKey(station);
    if (!key) continue;
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, { ...station });
      continue;
    }

    existing.sourceClaims = mergeSourceClaims(existing.sourceClaims, station.sourceClaims);
    existing.clickcount = Math.max(toPositiveInt(existing.clickcount), toPositiveInt(station.clickcount));
    existing.votes = Math.max(toPositiveInt(existing.votes), toPositiveInt(station.votes));
    existing.lastcheckok = Number(existing.lastcheckok) === 1 || Number(station.lastcheckok) === 1 ? 1 : 0;
    for (const field of ['favicon', 'homepage', 'tags', 'language', 'codec', 'country', 'countrycode', 'geo_lat', 'geo_long']) {
      if (!existing[field] && station[field]) existing[field] = station[field];
    }
  }

  return [...byId.values()].sort(compareStationRecords);
}

function stationRecordKey(station) {
  const uuid = cleanStationToken(station?.stationuuid || station?.changeuuid);
  if (uuid) return `uuid:${uuid}`;
  const url = cleanStationText(station?.url_resolved || station?.url).toLowerCase().replace(/\/+$/, '');
  if (url) return `url:${url}`;
  const name = cleanStationText(station?.name).toLowerCase();
  const country = cleanStationText(station?.countrycode || station?.country).toLowerCase();
  return name ? `name:${name}|${country}` : '';
}

function compareStationRecords(a, b) {
  const okDelta = Number(b.lastcheckok || 0) - Number(a.lastcheckok || 0);
  if (okDelta) return okDelta;
  const clickDelta = toPositiveInt(b.clickcount) - toPositiveInt(a.clickcount);
  if (clickDelta) return clickDelta;
  const voteDelta = toPositiveInt(b.votes) - toPositiveInt(a.votes);
  if (voteDelta) return voteDelta;
  return cleanStationText(a.name).localeCompare(cleanStationText(b.name));
}

function mergeSourceClaims(existing, additions) {
  const out = Array.isArray(existing) ? [...existing] : [];
  for (const claim of additions) {
    if (!out.some(item => String(item?.source || '') === claim.source)) out.push(claim);
  }
  return out;
}

function parseCountryCodes(value, fallback = FEATURED_COUNTRY_CODES) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  for (const item of raw) {
    const normalized = countryCodeAlias(String(item || '').trim().toUpperCase().replace(/[^A-Z]/g, ''));
    if (/^[A-Z]{2}$/.test(normalized)) seen.add(normalized);
    if (seen.size >= MAX_FEATURED_COUNTRY_CODES) break;
  }
  return seen.size ? [...seen] : [...fallback];
}

function countryCodeAlias(value) {
  return value === 'UK' ? 'GB' : value;
}

function toPositiveInt(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function cleanStationToken(value) {
  return cleanStationText(value).replace(/[^a-zA-Z0-9-]/g, '');
}

function cleanStationText(value) {
  return String(value ?? '').trim();
}

async function recordClick(uuid) {
  for (const base of RADIO_BROWSER_BASES) {
    try {
      return await fetchJson(`${base}/json/url/${encodeURIComponent(uuid)}`, 5000);
    } catch {
      // keep trying mirrors
    }
  }
  return { ok: false, reason: 'click telemetry unavailable' };
}

async function resolveStream(streamTarget) {
  const streamUrl = streamTarget.href;
  if (!isPlaylistUrl(streamUrl)) return { url: streamUrl, resolved: false };
  const text = await fetchText(streamTarget, 6000, { Range: `bytes=0-${MAX_PLAYLIST_BYTES - 1}` });
  const resolved = firstPlayableUrl(text, streamUrl);
  if (resolved) {
    const resolvedTarget = await resolvePublicTarget(resolved);
    return { url: resolvedTarget.href, resolved: true };
  }
  return { url: streamUrl, resolved: false };
}

async function probeStream(streamTarget) {
  const startedAt = Date.now();
  try {
    const response = await requestLimited(streamTarget, {
      timeoutMs: STREAM_TIMEOUT_MS,
      maxBytes: MAX_PROBE_BYTES,
      collectText: false,
      headers: {
        Accept: '*/*',
        Range: 'bytes=0-4095',
        'Icy-MetaData': '1',
        'User-Agent': USER_AGENT
      }
    });

    if (isRedirect(response.statusCode)) {
      const location = response.headers.location || '';
      const redirected = new URL(location, streamTarget.href).toString();
      await resolvePublicTarget(redirected);
      return { ok: false, status: 'redirect', redirectedUrl: redirected, latencyMs: Date.now() - startedAt, observedAt: new Date().toISOString() };
    }

    const ok = response.statusCode >= 200 && response.statusCode < 300 || response.statusCode === 206;
    return {
      ok,
      status: ok ? 'ok' : `http_${response.statusCode}`,
      httpStatus: response.statusCode,
      contentType: response.headers['content-type'] || '',
      icyName: response.headers['icy-name'] || '',
      icyGenre: response.headers['icy-genre'] || '',
      icyBitrate: response.headers['icy-br'] || '',
      icyMetaInterval: response.headers['icy-metaint'] || '',
      latencyMs: Date.now() - startedAt,
      observedAt: new Date().toISOString()
    };
  } catch (error) {
    return { ok: false, status: 'error', error: error?.name || error?.message || 'probe_failed', latencyMs: Date.now() - startedAt, observedAt: new Date().toISOString() };
  }
}

function streamNowPlayingSse(req, res, streamUrl) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    ...corsHeadersFor(req)
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, observedAt: new Date().toISOString() })}\n\n`);

  const close = subscribeIcyTitles(streamUrl, title => {
    res.write(`data: ${JSON.stringify({ streamTitle: title, observedAt: new Date().toISOString() })}\n\n`);
  }, error => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error?.message || 'nowplaying_error' })}\n\n`);
  });

  req.on('close', () => close());
}

function subscribeIcyTitles(streamTarget, onTitle, onError) {
  const client = streamTarget.url.protocol === 'https:' ? https : http;
  let closed = false;
  let request = null;
  let lastTitle = '';
  let remainingAudio = 0;
  let pending = Buffer.alloc(0);
  let metadataLength = null;

  request = client.get(streamTarget.url, {
    timeout: STREAM_TIMEOUT_MS,
    lookup: createPinnedLookup(streamTarget),
    headers: { 'Icy-MetaData': '1', 'User-Agent': USER_AGENT }
  }, response => {
    if (isRedirect(response.statusCode)) {
      onError?.(new Error('stream redirect blocked by now-playing resolver'));
      response.destroy();
      return;
    }
    const metaint = Number(response.headers['icy-metaint'] || 0);
    if (!Number.isFinite(metaint) || metaint <= 0) {
      onError?.(new Error('stream does not expose ICY metadata interval'));
      response.destroy();
      return;
    }
    remainingAudio = metaint;

    response.on('data', chunk => {
      if (closed) return;
      pending = Buffer.concat([pending, chunk]);
      while (pending.length > 0) {
        if (remainingAudio > 0) {
          const consume = Math.min(remainingAudio, pending.length);
          pending = pending.slice(consume);
          remainingAudio -= consume;
          if (remainingAudio > 0) break;
        }

        if (metadataLength === null) {
          if (pending.length < 1) break;
          metadataLength = pending[0] * 16;
          pending = pending.slice(1);
        }

        if (pending.length < metadataLength) break;
        const metadata = decodeIcyMetadata(pending.slice(0, metadataLength));
        pending = pending.slice(metadataLength);
        metadataLength = null;
        remainingAudio = metaint;
        const title = parseIcyTitle(metadata);
        if (title && title !== lastTitle) {
          lastTitle = title;
          onTitle(title);
        }
      }
    });
    response.on('error', onError);
  });

  request.on('timeout', () => request.destroy(new Error('nowplaying timeout')));
  request.on('error', error => { if (!closed) onError?.(error); });

  return () => {
    closed = true;
    try { request?.destroy(); } catch { /* best effort */ }
  };
}

function parseIcyTitle(metadata) {
  const match = String(metadata || '').match(/StreamTitle='([^']*)'/i) || String(metadata || '').match(/StreamTitle="([^"]*)"/i);
  return match ? match[1].trim() : '';
}

export function decodeIcyMetadata(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  let decoded = '';
  try {
    decoded = UTF8_METADATA_DECODER.decode(data);
  } catch {
    decoded = WINDOWS_1252_METADATA_DECODER.decode(data);
  }
  return decoded.replace(/\0+$/g, '').trim();
}

async function fetchJson(url, timeoutMs = 8000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(streamTarget, timeoutMs = 8000, headers = {}) {
  const response = await requestLimited(streamTarget, {
    timeoutMs,
    maxBytes: MAX_PLAYLIST_BYTES,
    collectText: true,
    headers: { Accept: '*/*', ...headers }
  });
  if (isRedirect(response.statusCode)) throw new Error('playlist redirect blocked by resolver');
  if (!(response.statusCode >= 200 && response.statusCode < 300) && response.statusCode !== 206) throw new Error(`HTTP ${response.statusCode}`);
  return response.text;
}

async function requestLimited(streamTarget, { timeoutMs = 8000, headers = {}, maxBytes = MAX_PLAYLIST_BYTES, collectText = true } = {}) {
  const target = typeof streamTarget === 'string' ? await resolvePublicTarget(streamTarget) : streamTarget;
  return new Promise((resolve, reject) => {
    const client = target.url.protocol === 'https:' ? https : http;
    const request = client.request(target.url, {
      method: 'GET',
      timeout: timeoutMs,
      lookup: createPinnedLookup(target),
      headers: { 'User-Agent': USER_AGENT, ...headers }
    }, response => {
      const statusCode = Number(response.statusCode || 0);
      const result = { statusCode, headers: response.headers, text: '' };
      if (isRedirect(statusCode)) {
        response.resume();
        resolve(result);
        return;
      }

      let received = 0;
      const chunks = [];
      response.on('data', chunk => {
        received += chunk.length;
        if (received > maxBytes) {
          request.destroy(new Error(`response exceeded ${maxBytes} byte limit`));
          return;
        }
        if (collectText) chunks.push(chunk);
      });
      response.on('end', () => {
        if (collectText) result.text = Buffer.concat(chunks).toString('utf8');
        resolve(result);
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('request timeout')));
    request.on('error', reject);
    request.end();
  });
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function sendRouteError(res, error) {
  const message = error?.message || 'internal error';
  const status = isClientInputError(message) ? 400 : 500;
  sendJson(res, status, { error: message });
}

function isClientInputError(message) {
  return /invalid url|only http\/https|missing stream host|private stream|blocked|did not resolve|localhost|origin not allowed|byte limit/i.test(String(message || ''));
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(Number(status));
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isPlaylistUrl(url) {
  return /\.(m3u8?|pls|xspf)(\?|#|$)/i.test(String(url || ''));
}

function firstPlayableUrl(text, baseUrl) {
  const source = String(text || '');
  if (source.includes('<location>')) {
    const match = source.match(/<location>([^<]+)<\/location>/i);
    if (match) return new URL(match[1].trim(), baseUrl).toString();
  }
  const plsMatch = source.match(/^File\d+=(.+)$/im);
  if (plsMatch) return new URL(plsMatch[1].trim(), baseUrl).toString();
  const line = source.split(/\r?\n/).map(item => item.trim()).find(item => item && !item.startsWith('#'));
  return line ? new URL(line, baseUrl).toString() : '';
}

async function assertPublicUrl(rawUrl) {
  return (await resolvePublicTarget(rawUrl)).href;
}

async function resolvePublicTarget(rawUrl) {
  const parsed = new URL(String(rawUrl || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('only http/https stream URLs are allowed');
  if (!parsed.hostname) throw new Error('missing stream host');

  const hostname = normalizeHostname(parsed.hostname);
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('private stream IPs are blocked');
    return { href: parsed.toString(), url: parsed, hostname, address: hostname, family: net.isIP(hostname) };
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: false });
  if (!records.length) throw new Error('stream host did not resolve');
  if (records.some(record => isPrivateIp(record.address))) throw new Error('stream host resolves to a private address');
  const record = records[0];
  return { href: parsed.toString(), url: parsed, hostname, address: record.address, family: record.family };
}

function createPinnedLookup(target) {
  return (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    if (!cb) return;
    if (normalizeHostname(hostname) === target.hostname) {
      cb(null, target.address, target.family);
      return;
    }
    dns.lookup(normalizeHostname(hostname), { all: false })
      .then(record => cb(null, record.address, record.family))
      .catch(error => cb(error));
  };
}

function normalizeHostname(hostname) {
  return String(hostname || '').replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function isLoopbackHost(hostname) {
  const host = normalizeHostname(hostname);
  if (host === 'localhost') return true;
  const kind = net.isIP(host);
  if (kind === 4) return host.startsWith('127.');
  if (kind === 6) return host === '::1';
  return false;
}

function corsHeadersFor(req) {
  const allowedOrigin = allowedCorsOrigin(req.headers.origin);
  return allowedOrigin ? { 'access-control-allow-origin': allowedOrigin, vary: 'origin' } : { vary: 'origin' };
}

function isPrivateIp(address) {
  const kind = net.isIP(address);
  if (kind === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }
  if (kind === 6) {
    const lower = address.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower.startsWith('ff');
  }
  return false;
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createDesktopProxy({ port: Number(process.env.PORT || process.env.EARTH_RADIO_PROXY_PORT || 8787) })
    .then(proxy => console.log(`Desktop proxy ready: ${proxy.baseUrl}`))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
