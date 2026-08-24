// Earth Radio hosting-platform now-playing resolvers.
// Many internet radio stations run on hosting platforms whose public APIs expose the
// real artist/title even when the ICY StreamTitle only carries the station name.
// Every candidate endpoint is derived from the station's own stream URL (or a fixed
// well-known platform API host) and fetched through the shared public-target guard.

import { requestLimited, resolvePublicTarget } from './net-guard.mjs';
import { createBoundedTtlCache, resolveWithCache } from './shared-cache.mjs';
import { parseNowPlaying } from './metadata-providers.mjs';

const USER_AGENT = 'EarthRadio/0.24.0 platform-nowplaying (+https://github.com/Protonmatter/EarthRadio)';
const DEFAULT_TIMEOUT_MS = 6000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const CACHE_MAX_ENTRIES = 256;
const CACHE_TTL_HIT_MS = 20 * 1000;
const CACHE_TTL_MISS_MS = 5 * 60 * 1000;

const nowPlayingCache = createBoundedTtlCache({ maxEntries: CACHE_MAX_ENTRIES });
const inFlight = new Map();

// Ordered platform candidates for a stream URL. Specific hosted platforms come first
// because their APIs return structured artist/title; generic Icecast/Shoutcast status
// endpoints follow as fallbacks on the stream's own origin.
export function detectPlatformEndpoints(streamUrl) {
  let url;
  try {
    url = new URL(String(streamUrl || '').trim());
  } catch {
    return [];
  }
  if (!['http:', 'https:'].includes(url.protocol)) return [];

  const origin = url.origin;
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;
  const endpoints = [];

  const zenoMount = host === 'stream.zeno.fm' ? pathname.replace(/^\/+/, '').split('/')[0] : '';
  if (zenoMount) {
    endpoints.push({ platform: 'zeno', kind: 'sse', url: `https://api.zeno.fm/mounts/metadata/subscribe/${encodeURIComponent(zenoMount)}` });
  }

  const radioCoStation = host.endsWith('.radio.co') ? (pathname.match(/^\/(s[0-9a-f]{9})\b/i)?.[1] || '') : '';
  if (radioCoStation) {
    endpoints.push({ platform: 'radioco', kind: 'json', url: `https://public.radio.co/stations/${encodeURIComponent(radioCoStation)}/status` });
  }

  const lautStation = (host === 'stream.laut.fm' || host.endsWith('.stream.laut.fm')) ? pathname.replace(/^\/+/, '').split('/')[0] : '';
  if (lautStation) {
    endpoints.push({ platform: 'lautfm', kind: 'json', url: `https://api.laut.fm/station/${encodeURIComponent(lautStation)}/current_song` });
  }

  const radiojarMount = host.endsWith('.radiojar.com') ? pathname.replace(/^\/+/, '').split('/')[0] : '';
  if (radiojarMount) {
    endpoints.push({ platform: 'radiojar', kind: 'json', url: `https://www.radiojar.com/api/stations/${encodeURIComponent(radiojarMount)}/now_playing/` });
  }

  const azuracastStation = pathname.match(/^\/listen\/([^/]+)\//)?.[1] || '';
  if (azuracastStation) {
    endpoints.push({ platform: 'azuracast', kind: 'json', url: `${origin}/api/nowplaying/${encodeURIComponent(azuracastStation)}` });
  }

  endpoints.push({ platform: 'icecast', kind: 'json', url: `${origin}/status-json.xsl`, mount: pathname });
  endpoints.push({ platform: 'shoutcast', kind: 'json', url: `${origin}/stats?json=1` });
  return endpoints;
}

export async function resolvePlatformNowPlaying(streamUrl, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchTextImpl = fetchTextGuarded } = {}) {
  const cacheKey = String(streamUrl || '').trim();
  if (!cacheKey) return notFound('missing stream url');
  return resolveWithCache({
    cache: nowPlayingCache,
    inFlight,
    key: cacheKey,
    produce: () => resolveUncached(cacheKey, { timeoutMs, fetchTextImpl }),
    ttlFor: payload => payload.found ? CACHE_TTL_HIT_MS : CACHE_TTL_MISS_MS
  });
}

async function resolveUncached(streamUrl, { timeoutMs, fetchTextImpl }) {
  const endpoints = detectPlatformEndpoints(streamUrl);
  const attempted = [];
  for (const endpoint of endpoints) {
    attempted.push(endpoint.platform);
    try {
      const text = await fetchTextImpl(endpoint, timeoutMs);
      if (!text) continue;
      const result = parsePlatformPayload(endpoint, text);
      if (result) return { ...result, found: true, endpoint: endpoint.url, attempted, fetchedAt: new Date().toISOString() };
    } catch {
      // Platform probing is best-effort; move on to the next candidate.
    }
  }
  return { ...notFound('no platform now-playing endpoint answered'), attempted };
}

export function parsePlatformPayload(endpoint, text) {
  if (endpoint.kind === 'sse') return parseZenoSse(text);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (endpoint.platform === 'azuracast') return parseAzuracast(data);
  if (endpoint.platform === 'radioco') return parseRadioCo(data);
  if (endpoint.platform === 'lautfm') return parseLautFm(data);
  if (endpoint.platform === 'radiojar') return parseRadiojar(data);
  if (endpoint.platform === 'icecast') return parseIcecast(data, endpoint.mount);
  if (endpoint.platform === 'shoutcast') return parseShoutcast(data);
  return null;
}

function parseAzuracast(data) {
  const song = data?.now_playing?.song;
  if (!song) return null;
  const artist = cleanText(song.artist);
  const title = cleanText(song.title);
  const raw = cleanText(song.text) || [artist, title].filter(Boolean).join(' - ');
  if (!title && !raw) return null;
  return withParsedFallback({ platform: 'azuracast', artist, title, raw, artworkUrl: httpsOnly(song.art) });
}

function parseRadioCo(data) {
  const raw = cleanText(data?.current_track?.title);
  if (!raw) return null;
  return withParsedFallback({ platform: 'radioco', artist: '', title: '', raw, artworkUrl: httpsOnly(data?.current_track?.artwork_url) });
}

function parseLautFm(data) {
  const title = cleanText(data?.title);
  const artist = cleanText(typeof data?.artist === 'object' ? data?.artist?.name : data?.artist);
  if (!title) return null;
  return { platform: 'lautfm', artist, title, raw: [artist, title].filter(Boolean).join(' - ') || title };
}

function parseRadiojar(data) {
  const title = cleanText(data?.title);
  const artist = cleanText(data?.artist);
  if (!title && !artist) return null;
  return withParsedFallback({ platform: 'radiojar', artist, title, raw: [artist, title].filter(Boolean).join(' - ') || title, artworkUrl: httpsOnly(data?.thumb) });
}

function parseIcecast(data, mountPath) {
  let sources = data?.icestats?.source;
  if (!sources) return null;
  if (!Array.isArray(sources)) sources = [sources];
  const wanted = String(mountPath || '').replace(/\/+$/, '');
  const match = sources.find(source => {
    try {
      return new URL(String(source?.listenurl || '')).pathname.replace(/\/+$/, '') === wanted;
    } catch {
      return false;
    }
  }) || (sources.length === 1 ? sources[0] : null);
  if (!match) return null;
  const artist = cleanText(match.artist);
  const title = cleanText(match.title);
  if (!artist && !title) return null;
  return withParsedFallback({ platform: 'icecast', artist, title, raw: [artist, title].filter(Boolean).join(' - ') || title });
}

function parseShoutcast(data) {
  const raw = cleanText(data?.songtitle);
  if (!raw) return null;
  return withParsedFallback({ platform: 'shoutcast', artist: '', title: '', raw });
}

function parseZenoSse(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const payload = JSON.parse(line.slice(5).trim());
      const raw = cleanText(payload?.streamTitle);
      if (raw) return withParsedFallback({ platform: 'zeno', artist: '', title: '', raw });
    } catch {
      // keep scanning subsequent events
    }
  }
  return null;
}

// Platforms that only expose a combined "Artist - Title" string reuse the shared
// ICY parser so junk/ad text is rejected consistently.
function withParsedFallback(result) {
  if (result.artist && result.title) return result;
  const parsed = parseNowPlaying(result.raw);
  if (!parsed) return null;
  if (result.artist && !result.title) {
    // An artist-only payload carries no track identity; without a real title the
    // parse would just echo the artist name back as the "song".
    return parsed.artist && parsed.title ? { ...result, artist: parsed.artist, title: parsed.title, raw: parsed.raw } : null;
  }
  return { ...result, artist: result.artist || parsed.artist, title: result.title || parsed.title, raw: parsed.raw };
}

async function fetchTextGuarded(endpoint, timeoutMs) {
  const target = await resolvePublicTarget(endpoint.url);
  const response = await requestLimited(target, {
    timeoutMs,
    maxBytes: MAX_RESPONSE_BYTES,
    // SSE subscriptions never end; stop after the first complete event frame.
    stopWhen: endpoint.kind === 'sse' ? ({ chunk, body }) => chunk.includes('\n\n') || body().includes('\n\n') : undefined,
    headers: {
      Accept: endpoint.kind === 'sse' ? 'text/event-stream' : 'application/json',
      'User-Agent': USER_AGENT
    }
  });
  if (response.statusCode < 200 || response.statusCode >= 300) return '';
  return response.text;
}

function notFound(reason) {
  return { found: false, reason };
}

function cleanText(value) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function httpsOnly(value) {
  const text = String(value || '').trim();
  return /^https:\/\//i.test(text) ? text : '';
}


export function clearPlatformNowPlayingCache() {
  nowPlayingCache.clear();
  inFlight.clear();
}
