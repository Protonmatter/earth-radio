// Earth Radio metadata providers v0.24.0
// Server-side resolver for ICY-derived track titles. No third-party dependencies.

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search';
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const DEFAULT_TIMEOUT_MS = 6500;
const JUNK_TITLE = /^(unknown|n\/?a|advert(isement)?|commercial|station\s?id|live stream|loading\.{0,3}|no title|news|weather|traffic)$/i;
const ADLIKE_TITLE = /\b(advertisement|commercial|sponsor|promo|listen live|news update|traffic|weather|sweeper|station id)\b/i;
const COVER_OR_TRIBUTE = /\b(karaoke|tribute|cover version|instrumental version|originally performed by|as made famous by|remix tribute)\b/i;

let spotifyToken = null;
let spotifyTokenExpiresAt = 0;

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

  const byMatch = raw.match(/^(.+?)\s+by\s+(.+?)$/i);
  if (byMatch) return { artist: byMatch[2].trim(), title: byMatch[1].trim(), raw };
  return { artist: '', title: raw, raw };
}

export async function identifyTrack({ artist = '', title = '', raw = '', providers = ['itunes', 'spotify'], country = 'US', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const track = title ? { artist: String(artist || ''), title: String(title || ''), raw: raw || [artist, title].filter(Boolean).join(' - ') } : parseNowPlaying(raw);
  if (!track?.title) return { found: false, state: 'Unresolved', confidence: 0, candidates: [], sources: [] };

  const wanted = new Set(providers.map(p => String(p).trim().toLowerCase()).filter(Boolean));
  const candidateGroups = await Promise.allSettled([
    wanted.has('itunes') ? searchItunes(track, { country, timeoutMs }) : [],
    wanted.has('spotify') ? searchSpotify(track, { country, timeoutMs }) : []
  ]);
  const candidates = candidateGroups.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const scored = scoreAndRank(track, candidates);
  const best = scored[0] || null;
  const state = best?.confidence >= 78 ? 'Identified' : best?.confidence >= 58 ? 'Likely match' : 'Raw ICY only';

  return {
    found: Boolean(best && best.confidence >= 58),
    state,
    confidence: best?.confidence || (track.artist ? 42 : 28),
    track: best || { provider: 'icy', title: track.title, artist: track.artist, raw: track.raw },
    candidates: scored.slice(0, 8),
    sources: [
      { provider: 'icy', confidence: track.artist ? 0.42 : 0.28, raw: track.raw, fetchedAt: new Date().toISOString() },
      ...scored.slice(0, 3).map(c => ({ provider: c.provider, providerId: c.providerId, confidence: c.confidence / 100, fetchedAt: new Date().toISOString() }))
    ]
  };
}

export async function searchItunes(track, { country = 'US', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const term = [track.artist, track.title].filter(Boolean).join(' ').trim();
  if (!term) return [];
  const url = new URL(ITUNES_SEARCH_URL);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '8');
  url.searchParams.set('term', term);
  if (/^[A-Z]{2}$/i.test(country)) url.searchParams.set('country', country.toUpperCase());
  const data = await fetchJson(url, timeoutMs);
  return Array.isArray(data?.results) ? data.results.map(normalizeItunes).filter(Boolean) : [];
}

export async function searchSpotify(track, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const token = await getSpotifyToken(timeoutMs);
  if (!token) return [];
  const queryParts = [];
  if (track.artist) queryParts.push(`artist:${quoteSpotify(track.artist)}`);
  if (track.title) queryParts.push(`track:${quoteSpotify(track.title)}`);
  const url = new URL(SPOTIFY_SEARCH_URL);
  url.searchParams.set('type', 'track');
  url.searchParams.set('limit', '8');
  url.searchParams.set('q', queryParts.join(' ') || [track.artist, track.title].filter(Boolean).join(' '));
  const data = await fetchJson(url, timeoutMs, { Authorization: `Bearer ${token}` });
  return Array.isArray(data?.tracks?.items) ? data.tracks.items.map(normalizeSpotify).filter(Boolean) : [];
}

async function getSpotifyToken(timeoutMs) {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (spotifyToken && spotifyTokenExpiresAt > Date.now() + 30_000) return spotifyToken;
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

async function fetchJson(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
