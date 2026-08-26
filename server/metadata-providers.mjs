// Earth Radio metadata providers v0.24.0
// Server-side resolver for ICY-derived track titles. No third-party dependencies.

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search';
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const DEFAULT_TIMEOUT_MS = 6500;
const IDENTIFY_CACHE_MAX_ENTRIES = 512;
const IDENTIFY_CACHE_TTL_FOUND_MS = 24 * 60 * 60 * 1000;
const IDENTIFY_CACHE_TTL_MISS_MS = 15 * 60 * 1000;
// Marks a miss produced while a provider was unreachable; such results are served
// to the caller but never written to the negative cache.
const IDENTIFY_TRANSIENT = Symbol('identify-transient-miss');
const JUNK_TITLE = /^(unknown|n\/?a|advert(isement)?|commercial|station\s?id|live stream|loading\.{0,3}|no title|news|weather|traffic)$/i;
const ADLIKE_TITLE = /\b(advertisement|commercial|sponsor|promo|listen live|news update|traffic|weather|sweeper|station id)\b/i;
const COVER_OR_TRIBUTE = /\b(karaoke|tribute|cover version|instrumental version|originally performed by|as made famous by|remix tribute)\b/i;
const PROVIDERS = new Set(['itunes', 'spotify']);
const TITLE_ONLY_PROMOTION_REASON = 'title-only ICY metadata is raw broadcast text, not enough to identify a track';
const AMBIGUOUS_TITLE_ONLY_TERMS = new Set([
  'africa', 'america', 'asia', 'australia', 'brazil', 'canada', 'china', 'england', 'europe',
  'france', 'germany', 'india', 'italy', 'japan', 'korea', 'mexico', 'netherlands', 'spain',
  'united kingdom', 'united states', 'live', 'radio', 'fm', 'top hits', 'hits', 'music'
]);

let spotifyToken = null;
let spotifyTokenExpiresAt = 0;
let spotifyTokenPromise = null;
const identifyCache = new Map();
const identifyInFlight = new Map();

export function parseNowPlaying(streamTitle = '') {
  const raw = stripRadioNoise(streamTitle);
  if (!raw || JUNK_TITLE.test(raw) || ADLIKE_TITLE.test(raw)) return null;

  for (const separator of [/\s[-\u2013\u2014]\s/, /\s::\s/, /\s\|\s/, /\s\/\s/]) {
    const parts = raw.split(separator).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const artist = parts[0];
      const title = parts.slice(1).join(' - ');
      if (artist && title && !JUNK_TITLE.test(title)) return { artist, title, raw };
    }
  }

  // Lowercase "by" only: title-cased "By" ("Stand By Me") is part of the title.
  const byMatch = raw.match(/^(.+?)\s+by\s+(.+)$/);
  if (byMatch) return { artist: byMatch[2].trim(), title: byMatch[1].trim(), raw };
  return { artist: '', title: raw, raw };
}

export async function identifyTrack(args = {}) {
  const request = normalizeIdentifyRequest(args);
  const cacheKey = identifyCacheKey(request);
  const cached = readIdentifyCache(cacheKey);
  if (cached) return { ...cached, cached: true };
  if (identifyInFlight.has(cacheKey)) return { ...await withinDeadline(identifyInFlight.get(cacheKey), request.deadlineAt), cached: true };

  const promise = identifyTrackUncached(request);
  identifyInFlight.set(cacheKey, promise);
  try {
    const payload = await withinDeadline(promise, request.deadlineAt);
    // A miss produced while a queried provider was unreachable (transport error or
    // deadline abort) is not evidence the catalog lacks the track; caching it would
    // pin a Raw ICY answer for the full negative TTL after the providers recover.
    if (!payload[IDENTIFY_TRANSIENT]) {
      writeIdentifyCache(cacheKey, payload, payload.found ? IDENTIFY_CACHE_TTL_FOUND_MS : IDENTIFY_CACHE_TTL_MISS_MS);
    }
    return payload;
  } finally {
    identifyInFlight.delete(cacheKey);
  }
}

async function identifyTrackUncached({
  artist = '',
  title = '',
  raw = '',
  providers = ['itunes', 'spotify'],
  country = 'US',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  deadlineAt = Date.now() + timeoutMs
} = {}) {
  const track = title ? { artist: String(artist || ''), title: String(title || ''), raw: raw || [artist, title].filter(Boolean).join(' - ') } : parseNowPlaying(raw);
  if (!track?.title) return { found: false, state: 'Unresolved', confidence: 0, candidates: [], sources: [] };

  const wanted = new Set(providers);
  const candidateGroups = await Promise.allSettled([
    wanted.has('itunes') ? searchItunes(track, { country, timeoutMs, deadlineAt }) : [],
    wanted.has('spotify') ? searchSpotify(track, { country, timeoutMs, deadlineAt }) : []
  ]);
  const candidates = candidateGroups.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const providerFailures = candidateGroups.filter(result => result.status === 'rejected').length;
  const scored = scoreAndRank(track, candidates);
  const best = scored[0] || null;
  if (!canPromoteCandidate(track, best, scored)) {
    const identity = rawIcyIdentity(track, scored, best ? blockedPromotionReason(track, best) : 'no catalog match above confidence threshold');
    if (providerFailures > 0) Object.defineProperty(identity, IDENTIFY_TRANSIENT, { value: true });
    return identity;
  }

  const state = best.confidence >= 78 ? 'Identified' : 'Likely match';
  const resolvedTrack = best;
  const confidence = best.confidence;

  return {
    found: true,
    state,
    confidence,
    provider: resolvedTrack.provider || 'icy',
    providerId: resolvedTrack.providerId || '',
    title: resolvedTrack.title || track.title,
    artist: resolvedTrack.artist || track.artist,
    album: resolvedTrack.album || '',
    releaseYear: resolvedTrack.releaseYear || '',
    genre: resolvedTrack.genre || '',
    isrc: resolvedTrack.isrc || '',
    durationMs: resolvedTrack.durationMs,
    explicit: Boolean(resolvedTrack.explicit),
    artworkUrl: resolvedTrack.artworkUrl || '',
    previewUrl: resolvedTrack.previewUrl || '',
    appleMusicUrl: resolvedTrack.appleMusicUrl || '',
    spotifyUrl: resolvedTrack.spotifyUrl || '',
    links: buildSearchLinks(track, resolvedTrack),
    reasons: resolvedTrack.reasons || [],
    raw: track.raw,
    track: resolvedTrack,
    candidates: scored.slice(0, 8),
    sources: [
      { provider: 'icy', confidence: track.artist ? 0.42 : 0.28, raw: track.raw, fetchedAt: new Date().toISOString() },
      ...scored.slice(0, 3).map(c => ({ provider: c.provider, providerId: c.providerId, confidence: c.confidence / 100, fetchedAt: new Date().toISOString() }))
    ]
  };
}

function rawIcyIdentity(track, candidates = [], reason = TITLE_ONLY_PROMOTION_REASON) {
  const confidence = track.artist ? 42 : 28;
  return {
    found: false,
    state: 'Raw ICY only',
    confidence,
    provider: 'icy',
    providerId: '',
    title: track.title,
    artist: track.artist,
    album: '',
    releaseYear: '',
    genre: '',
    isrc: '',
    explicit: false,
    artworkUrl: '',
    previewUrl: '',
    appleMusicUrl: '',
    spotifyUrl: '',
    links: {},
    reasons: [reason],
    raw: track.raw,
    track: { provider: 'icy', title: track.title, artist: track.artist, raw: track.raw, confidence, reasons: [reason] },
    candidates: candidates.slice(0, 8),
    sources: [{ provider: 'icy', confidence: confidence / 100, raw: track.raw, fetchedAt: new Date().toISOString() }]
  };
}

export function clearIdentifyCache() {
  identifyCache.clear();
  identifyInFlight.clear();
}

export function getIdentifyCacheSize() {
  return identifyCache.size;
}

async function searchItunes(track, { country = 'US', timeoutMs = DEFAULT_TIMEOUT_MS, deadlineAt = Date.now() + timeoutMs } = {}) {
  const term = [track.artist, track.title].filter(Boolean).join(' ').trim();
  if (!term) return [];
  const url = new URL(ITUNES_SEARCH_URL);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '8');
  url.searchParams.set('term', term);
  if (/^[A-Z]{2}$/i.test(country)) url.searchParams.set('country', country.toUpperCase());
  const data = await fetchJson(url, timeoutMs, {}, deadlineAt);
  // null is a transport failure or deadline abort, not an empty catalog answer;
  // the distinction keeps transient failures out of the negative identify cache.
  if (data === null) throw new Error('iTunes search unavailable');
  return Array.isArray(data?.results) ? data.results.map(normalizeItunes).filter(Boolean) : [];
}

async function searchSpotify(track, { country = 'US', timeoutMs = DEFAULT_TIMEOUT_MS, deadlineAt = Date.now() + timeoutMs } = {}) {
  const token = await getSpotifyToken(timeoutMs, deadlineAt);
  if (!token) {
    // No credentials means Spotify is simply unconfigured (a cacheable miss);
    // configured credentials with no token is a transient auth/transport failure.
    if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) throw new Error('Spotify token unavailable');
    return [];
  }
  const queryParts = [];
  if (track.artist) queryParts.push(`artist:${quoteSpotify(track.artist)}`);
  if (track.title) queryParts.push(`track:${quoteSpotify(track.title)}`);
  const url = new URL(SPOTIFY_SEARCH_URL);
  url.searchParams.set('type', 'track');
  url.searchParams.set('limit', '8');
  url.searchParams.set('q', queryParts.join(' ') || [track.artist, track.title].filter(Boolean).join(' '));
  if (/^[A-Z]{2}$/i.test(country)) url.searchParams.set('market', country.toUpperCase());
  const data = await fetchJson(url, timeoutMs, { Authorization: `Bearer ${token}` }, deadlineAt);
  if (data === null) throw new Error('Spotify search unavailable');
  return Array.isArray(data?.tracks?.items) ? data.tracks.items.map(normalizeSpotify).filter(Boolean) : [];
}

async function getSpotifyToken(timeoutMs, deadlineAt) {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (spotifyToken && spotifyTokenExpiresAt > Date.now() + 30_000) return spotifyToken;
  if (!spotifyTokenPromise) {
    spotifyTokenPromise = requestSpotifyToken(id, secret, timeoutMs, deadlineAt).finally(() => { spotifyTokenPromise = null; });
  }
  return spotifyTokenPromise;
}

async function requestSpotifyToken(id, secret, timeoutMs, deadlineAt) {
  const remaining = Math.min(timeoutMs, deadlineAt - Date.now());
  if (remaining <= 0) return null;
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    });
    if (!response.ok) return null;
    const data = await response.json();
    spotifyToken = data.access_token || null;
    spotifyTokenExpiresAt = spotifyToken ? Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000 : 0;
    return spotifyToken;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function quoteSpotify(value) {
  return `"${String(value || '').replace(/["\\]/g, ' ').trim()}"`;
}

function normalizeItunes(result) {
  if (!result?.trackName) return null;
  return {
    provider: 'itunes',
    providerId: result.trackId ? String(result.trackId) : '',
    title: result.trackName || '',
    artist: result.artistName || '',
    album: result.collectionName || '',
    releaseYear: result.releaseDate ? String(result.releaseDate).slice(0, 4) : '',
    genre: result.primaryGenreName || '',
    isrc: result.isrc || '',
    durationMs: result.trackTimeMillis,
    artworkUrl: String(result.artworkUrl100 || '').replace(/\/(\d+)x(\d+)bb\.(jpg|png)/, '/512x512bb.$3'),
    previewUrl: result.previewUrl || '',
    appleMusicUrl: result.trackViewUrl || ''
  };
}

function normalizeSpotify(item) {
  if (!item?.name) return null;
  const album = item.album || {};
  return {
    provider: 'spotify',
    providerId: item.id || '',
    title: item.name || '',
    artist: Array.isArray(item.artists) ? item.artists.map(a => a.name).filter(Boolean).join(', ') : '',
    album: album.name || '',
    releaseYear: album.release_date ? String(album.release_date).slice(0, 4) : '',
    genre: '',
    isrc: item.external_ids?.isrc || '',
    durationMs: item.duration_ms,
    explicit: item.explicit,
    artworkUrl: Array.isArray(album.images) && album.images[0]?.url ? album.images[0].url : '',
    spotifyUrl: item.external_urls?.spotify || ''
  };
}

function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildSearchLinks(track, identity = {}) {
  const query = encodeURIComponent([identity.artist || track.artist, identity.title || track.title].filter(Boolean).join(' ').trim());
  return {
    spotify: identity.spotifyUrl || `https://open.spotify.com/search/${query}`,
    appleMusic: identity.appleMusicUrl || `https://music.apple.com/search?term=${query}`,
    youtubeMusic: `https://music.youtube.com/search?q=${query}`,
    tidal: `https://tidal.com/search?q=${query}`
  };
}

function similarity(a, b) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return Math.min(x.length, y.length) / Math.max(x.length, y.length);
  const xs = new Set(x.split(' ').filter(Boolean));
  const ys = new Set(y.split(' ').filter(Boolean));
  const intersection = [...xs].filter(token => ys.has(token)).length;
  const union = new Set([...xs, ...ys]).size;
  return union ? intersection / union : 0;
}

export function scoreAndRank(track, candidates) {
  const isrcCounts = candidates.reduce((acc, c) => {
    if (c.isrc) acc[c.isrc] = (acc[c.isrc] || 0) + 1;
    return acc;
  }, {});
  const commonIsrc = Object.entries(isrcCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return candidates.map(candidate => {
    const titleSim = similarity(track.title, candidate.title);
    const artistSim = track.artist ? similarity(track.artist, candidate.artist) : 0;
    let confidence = 0;
    const reasons = [];
    if (normalize(track.title) === normalize(candidate.title)) { confidence += 40; reasons.push('exact title match'); }
    else if (titleSim >= 0.9) { confidence += 32; reasons.push('near-exact title match'); }
    else if (titleSim >= 0.68) { confidence += Math.round(18 * titleSim); reasons.push('fuzzy title match'); }
    if (track.artist) {
      if (normalize(track.artist) === normalize(candidate.artist)) { confidence += 30; reasons.push('exact artist match'); }
      else if (artistSim >= 0.9) { confidence += 24; reasons.push('near-exact artist match'); }
      else if (artistSim >= 0.6) { confidence += Math.round(16 * artistSim); reasons.push('fuzzy artist match'); }
      else { confidence -= 28; reasons.push('artist mismatch'); }
    } else {
      confidence += Math.round(10 * titleSim);
      reasons.push('title-only ICY metadata');
    }
    if (candidate.isrc && commonIsrc && candidate.isrc === commonIsrc) { confidence += 10; reasons.push('ISRC agreement across providers'); }
    if (candidate.genre) { confidence += 4; reasons.push('catalog genre returned'); }
    if (candidate.artworkUrl) { confidence += 4; reasons.push('catalog artwork returned'); }
    if (candidate.previewUrl) { confidence += 2; reasons.push('preview available'); }
    if (COVER_OR_TRIBUTE.test(`${candidate.artist} ${candidate.title} ${candidate.album || ''}`)) {
      confidence -= 38;
      reasons.push('cover/karaoke/tribute penalty');
    }
    return { ...candidate, confidence: Math.max(0, Math.min(100, confidence)), reasons };
  }).sort((a, b) => b.confidence - a.confidence || providerRank(a.provider) - providerRank(b.provider));
}

function canPromoteCandidate(track, best, scored = []) {
  if (!best || best.confidence < 58) return false;
  if (track.artist) return true;
  return hasCrossProviderIsrcAgreement(best, scored);
}

function hasCrossProviderIsrcAgreement(best, scored) {
  if (!best?.isrc) return false;
  return scored.some(candidate => candidate !== best && candidate.isrc === best.isrc && candidate.provider !== best.provider);
}

function blockedPromotionReason(track, best) {
  if (!track.artist) {
    return isAmbiguousTitleOnly(track.title)
      ? 'title-only ICY metadata looks like a station, geography, or common label'
      : TITLE_ONLY_PROMOTION_REASON;
  }
  return best?.confidence >= 58 ? 'catalog candidate did not pass identity trust gates' : 'no catalog match above confidence threshold';
}

function isAmbiguousTitleOnly(title) {
  const value = normalize(title);
  if (!value) return true;
  if (AMBIGUOUS_TITLE_ONLY_TERMS.has(value)) return true;
  return value.length <= 2 || /\b(radio|fm|am|live|news|hits?)\b/.test(value);
}

function stripRadioNoise(value) {
  return String(value || '')
    .replace(/StreamTitle=/i, '')
    .replace(/^['"]|['"];?$/g, '')
    .replace(/\s*\|\s*(live|radio).*$/i, '')
    .replace(/\s*[-\u2013\u2014]\s*(live on .*|\d{2,4}\.?\d?\s?fm|\w+ radio)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function providerRank(provider) {
  return provider === 'spotify' ? 0 : provider === 'itunes' ? 1 : 2;
}

function normalizeIdentifyRequest(args = {}) {
  const providers = Array.isArray(args.providers) ? args.providers : String(args.providers || 'itunes,spotify').split(',');
  const sanitizedProviders = [...new Set(providers
    .map(provider => String(provider || '').trim().toLowerCase())
    .filter(provider => PROVIDERS.has(provider)))];
  const timeoutMs = clampInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 30_000);
  const suppliedDeadline = Number(args.deadlineAt);
  return {
    artist: sanitizeText(args.artist, 200),
    title: sanitizeText(args.title, 200),
    raw: sanitizeText(args.raw, 500),
    providers: sanitizedProviders.length ? sanitizedProviders : ['itunes', 'spotify'],
    country: /^[A-Z]{2}$/i.test(String(args.country || 'US')) ? String(args.country || 'US').toUpperCase() : 'US',
    timeoutMs,
    deadlineAt: Number.isFinite(suppliedDeadline) && suppliedDeadline > 0 ? suppliedDeadline : Date.now() + timeoutMs
  };
}

function identifyCacheKey(request) {
  return JSON.stringify({
    artist: normalize(request.artist),
    title: normalize(request.title),
    raw: normalize(request.raw),
    providers: [...request.providers].sort(),
    country: request.country
  });
}

function readIdentifyCache(cacheKey) {
  const entry = identifyCache.get(cacheKey);
  if (!entry || entry.expiresAt <= Date.now()) {
    identifyCache.delete(cacheKey);
    return null;
  }
  entry.lastAccessedAt = Date.now();
  return cloneJson(entry.payload);
}

function writeIdentifyCache(cacheKey, payload, ttlMs) {
  identifyCache.set(cacheKey, { payload: cloneJson(payload), expiresAt: Date.now() + ttlMs, lastAccessedAt: Date.now() });
  if (identifyCache.size <= IDENTIFY_CACHE_MAX_ENTRIES) return;
  const oldest = [...identifyCache.entries()].sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)[0]?.[0];
  if (oldest) identifyCache.delete(oldest);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function fetchJson(url, timeoutMs, headers = {}, deadlineAt = Date.now() + timeoutMs) {
  const remaining = Math.min(timeoutMs, deadlineAt - Date.now());
  if (remaining <= 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', ...headers } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function withinDeadline(promise, deadlineAt) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return Promise.reject(new Error('metadata deadline exceeded'));
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('metadata deadline exceeded')), remaining);
    })
  ]).finally(() => clearTimeout(timer));
}
