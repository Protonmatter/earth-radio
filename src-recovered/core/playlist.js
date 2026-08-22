// Pure parser for common radio playlist containers (.pls, .m3u, .asx/.xspf) into an ordered
// list of concrete stream URLs. Plain JS so the Node proxy and the browser can both use it.
// HLS (.m3u8) is intentionally NOT treated as a container; it is played by the HLS engine.

const PLAYLIST_EXTENSIONS = ['.pls', '.m3u', '.asx', '.xspf'];

export function isPlaylistUrl(url) {
  try {
    const pathname = new URL(String(url)).pathname.toLowerCase();
    if (pathname.endsWith('.m3u8')) return false;
    return PLAYLIST_EXTENSIONS.some(ext => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

export function isHlsUrl(url) {
  try {
    return new URL(String(url)).pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return false;
  }
}

export function parsePlaylist(text, contentType = '') {
  const body = String(text || '');
  const type = String(contentType || '').toLowerCase();

  if (type.includes('pls') || /^\s*\[playlist\]/i.test(body)) return dedupeHttp(parsePls(body));
  if (type.includes('xml') || type.includes('asx') || type.includes('xspf') || /<asx|<playlist|<ref\b|<location>/i.test(body)) {
    return dedupeHttp(parseXmlLike(body));
  }
  return dedupeHttp(parseM3u(body));
}

export function firstPlayableUrl(text, contentType = '') {
  return parsePlaylist(text, contentType)[0] || '';
}

function parsePls(body) {
  const urls = [];
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*File\d+\s*=\s*(.+)\s*$/i);
    if (match) urls.push(match[1].trim());
  }
  return urls;
}

function parseM3u(body) {
  const urls = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    urls.push(trimmed);
  }
  return urls;
}

function parseXmlLike(body) {
  const urls = [];
  const attrRegex = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attrRegex.exec(body))) urls.push(match[1].trim());
  const locationRegex = /<location>\s*([^<]+?)\s*<\/location>/gi;
  while ((match = locationRegex.exec(body))) urls.push(match[1].trim());
  return urls;
}

function dedupeHttp(urls) {
  const seen = new Set();
  const result = [];
  for (const url of urls) {
    const trimmed = String(url || '').trim();
    if (!isHttp(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function isHttp(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
