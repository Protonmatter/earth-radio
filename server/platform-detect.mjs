// Pure platform detection and payload parsing for hosting-platform now-playing APIs.
// No network or Node APIs: shared by the Node resolvers (server/platform-nowplaying.mjs)
// and the Cloudflare Pages Function (functions/api/nowplaying.js).

import { looksLikeStationBranding } from './icy-title.mjs';
import { parseNowPlaying } from './metadata-providers.mjs';

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

  const somafmId = somafmStationIdFromHostPath(host, pathname);
  if (somafmId) {
    endpoints.push({ platform: 'somafm', kind: 'json', url: `https://somafm.com/songs/${encodeURIComponent(somafmId)}.json` });
  }

  endpoints.push({ platform: 'icecast', kind: 'json', url: `${origin}/status-json.xsl`, mount: pathname });
  endpoints.push({ platform: 'shoutcast', kind: 'json', url: `${origin}/stats?json=1` });
  return endpoints;
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
  if (endpoint.platform === 'somafm') return parseSomaFm(data);
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

function parseSomaFm(data) {
  const song = Array.isArray(data?.songs) ? data.songs[0] : null;
  const title = cleanText(song?.title);
  const artist = cleanText(song?.artist);
  if (!title) return null;
  return {
    platform: 'somafm',
    artist,
    title,
    raw: [artist, title].filter(Boolean).join(' - ') || title,
    artworkUrl: httpsOnly(song?.albumArt)
  };
}

export function somafmStationId(streamUrl) {
  let url;
  try {
    url = new URL(String(streamUrl || '').trim());
  } catch {
    return '';
  }
  return somafmStationIdFromHostPath(url.hostname.toLowerCase(), url.pathname);
}

function somafmStationIdFromHostPath(host, pathname) {
  if (host !== 'somafm.com' && !host.endsWith('.somafm.com')) return '';
  const segment = String(pathname || '').replace(/^\/+/, '').split('/')[0] || '';
  if (!segment || /\.(pls|m3u8?|xspf)$/i.test(segment)) return '';
  return segment.replace(/-\d+-(mp3|aacp?)$/i, '').replace(/-\d+$/, '');
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

// SSE subscriptions never end on their own, so readers stop once a complete data
// event has arrived. Servers may delimit frames with LF or CRLF blank lines, and the
// first frame is often a comment/heartbeat carrying no data: line — waiting for a
// terminated frame that actually contains data avoids both hanging on CRLF streams
// and stopping before any usable event.
export function sseFrameComplete(text) {
  const frames = String(text || '').replace(/\r\n/g, '\n').split('\n\n');
  return frames.length > 1 && frames.slice(0, -1).some(frame => /^data:/m.test(frame));
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

function titleNeedsReparse(title) {
  const text = String(title || '');
  return looksLikeStationBranding(text) || /\b(?:text|title)\s*=\s*"/i.test(text);
}

function artistsAgree(left, right) {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

// Platforms that only expose a combined "Artist - Title" string reuse the shared
// ICY parser so junk/ad text is rejected consistently. Icecast often puts the
// branded "Title by Artist - Station on example.com" string in `title` even when
// `artist` is already populated; reparse those instead of promoting the blob.
// A real title that happens to contain lowercase "by" ("Stand by Me") must keep
// the structured artist: only apply a reparse when it agrees with that artist.
function withParsedFallback(result) {
  if (result.artist && result.title && !titleNeedsReparse(result.title)) {
    const parsed = parseNowPlaying(result.title);
    if (parsed?.artist && parsed?.title && artistsAgree(parsed.artist, result.artist)) {
      return { ...result, title: parsed.title, raw: parsed.raw || result.raw };
    }
    return result;
  }
  const parsed = parseNowPlaying(result.title && titleNeedsReparse(result.title) ? result.title : result.raw);
  if (!parsed) return result.artist && result.title ? result : null;
  if (result.artist && !result.title) {
    // An artist-only payload carries no track identity; without a real title the
    // parse would just echo the artist name back as the "song".
    return parsed.artist && parsed.title ? { ...result, artist: parsed.artist, title: parsed.title, raw: parsed.raw } : null;
  }
  if (parsed.artist && parsed.title) {
    if (result.artist && !artistsAgree(parsed.artist, result.artist)) return result;
    return { ...result, artist: result.artist || parsed.artist, title: parsed.title, raw: parsed.raw };
  }
  return { ...result, artist: result.artist || parsed.artist, title: result.title || parsed.title, raw: parsed.raw };
}


function cleanText(value) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function httpsOnly(value) {
  const text = String(value || '').trim();
  return /^https:\/\//i.test(text) ? text : '';
}
