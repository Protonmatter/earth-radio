// Now-playing identification + enrichment for the sidecar.
//
// Radio streams broadcast the current track via ICY metadata ("Artist - Title"), so the
// most reliable "what's playing" signal is that metadata — not acoustic fingerprinting.
// We parse it, resolve canonical metadata + cover art + an Apple Music link via the iTunes
// catalog, and build search/deep links for the major streaming services. See SPEC-NOWPLAYING-001.
import { getRuntimeConfig } from './config';

export interface NowPlayingTrack {
  artist: string;
  title: string;
  raw: string;
}

export interface TrackEnrichment {
  found: boolean;
  artist: string;
  title: string;
  album?: string;
  artworkUrl?: string;
  previewUrl?: string;
  appleMusicUrl?: string;
  releaseYear?: string;
  genre?: string;
}

export interface CountryFacts {
  code: string;
  name: string;
  flag: string;
  capital: string;
  population: number;
  region: string;
  income?: string;
  languages: string[];
  currencies: string[];
}

export interface MusicLink {
  id: string;
  label: string;
  url: string;
}

const JUNK_TITLE = /^(unknown|n\/?a|advert(isement)?|commercial|station\s?id|live stream|loading\.{0,3}|no title|news|weather|traffic)$/i;
const ADLIKE_TITLE = /\b(advertisement|commercial|sponsor|promo|listen live|news update|traffic|weather|sweeper|station id)\b/i;

/** Pure parser for an ICY StreamTitle into artist/title. Unit-tested (REQ-NP-IDENTIFY). */
export function parseNowPlaying(streamTitle: string): NowPlayingTrack | null {
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

function stripRadioNoise(value: string): string {
  return String(value || '')
    .replace(/StreamTitle=/i, '')
    .replace(/^['"]|['"];?$/g, '')
    .replace(/\s*\|\s*(live|radio).*$/i, '')
    .replace(/\s*[-\u2013\u2014]\s*(live on .*|\d{2,4}\.?\d?\s?fm|\w+ radio)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pure builder of streaming-service deep links. Unit-tested (REQ-NP-IDENTIFY). */
export function musicLinks(track: NowPlayingTrack, appleMusicUrl = ''): MusicLink[] {
  const query = encodeURIComponent([track.artist, track.title].filter(Boolean).join(' ').trim());
  return [
    { id: 'spotify', label: 'Spotify', url: `https://open.spotify.com/search/${query}` },
    { id: 'apple', label: 'Apple Music', url: appleMusicUrl || `https://music.apple.com/search?term=${query}` },
    { id: 'youtube', label: 'YouTube Music', url: `https://music.youtube.com/search?q=${query}` },
    { id: 'tidal', label: 'Tidal', url: `https://tidal.com/search?q=${query}` }
  ];
}

export async function identifyTrack(track: NowPlayingTrack): Promise<TrackEnrichment> {
  const fallback: TrackEnrichment = { found: false, artist: track.artist, title: track.title };
  const config = getRuntimeConfig();

  try {
    if (config.proxyBaseUrl) {
      const base = config.proxyBaseUrl.replace(/\/+$/, '');
      const url = `${base}/api/track/identify?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}`;
      return (await fetchJson<TrackEnrichment>(url)) ?? fallback;
    }

    const term = encodeURIComponent([track.artist, track.title].filter(Boolean).join(' ').trim());
    const data = await fetchJson<{ results?: ItunesResult[] }>(`https://itunes.apple.com/search?media=music&entity=song&limit=1&term=${term}`);
    const result = data?.results?.[0];
    if (!result) return fallback;
    return {
      found: true,
      artist: result.artistName || track.artist,
      title: result.trackName || track.title,
      album: result.collectionName || '',
      artworkUrl: String(result.artworkUrl100 || '').replace(/\/(\d+)x(\d+)bb\.(jpg|png)/, '/512x512bb.$3'),
      previewUrl: result.previewUrl || '',
      appleMusicUrl: result.trackViewUrl || '',
      releaseYear: result.releaseDate ? String(result.releaseDate).slice(0, 4) : '',
      genre: result.primaryGenreName || ''
    };
  } catch {
    return fallback;
  }
}

export async function getCountryFacts(code: string): Promise<CountryFacts | null> {
  const cc = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;

  // Facts are a proxy-backed feature (like ICY now-playing): the proxy aggregates the World
  // Bank API and a static language/currency map. In pure web-direct mode they're skipped.
  const config = getRuntimeConfig();
  if (!config.proxyBaseUrl) return null;

  try {
    const base = config.proxyBaseUrl.replace(/\/+$/, '');
    const data = await fetchJson<CountryFacts & { found?: boolean }>(`${base}/api/geo/country?code=${cc}`);
    return data && data.found !== false && data.name ? data : null;
  } catch {
    return null;
  }
}

interface ItunesResult {
  artistName?: string;
  trackName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
  releaseDate?: string;
  primaryGenreName?: string;
}

async function fetchJson<T>(url: string, timeoutMs = 7000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
