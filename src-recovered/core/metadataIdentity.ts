// Source-side implementation sketch for the 0.24.0 metadata system.
// The runnable overlay is in dist/assets/metadata-enrichment.js until the full repo is rebuilt.

export interface ParsedTrack {
  artist: string;
  title: string;
  raw: string;
}

export interface MetadataSource {
  provider: 'icy' | 'itunes' | 'spotify' | 'proxy' | string;
  providerId?: string;
  confidence: number;
  fetchedAt: string;
  raw?: string;
}

export interface TrackIdentity {
  found: boolean;
  state: 'Identified' | 'Likely match' | 'Raw ICY only' | 'Station metadata only' | 'Unresolved';
  confidence: number;
  title: string;
  artist: string;
  album?: string;
  releaseYear?: string;
  genre?: string;
  isrc?: string;
  durationMs?: number;
  explicit?: boolean;
  artworkUrl?: string;
  previewUrl?: string;
  links: {
    spotify?: string;
    appleMusic?: string;
    youtubeMusic?: string;
    tidal?: string;
  };
  sources: MetadataSource[];
  reasons: string[];
  raw: string;
}

const JUNK_TITLE = /^(unknown|n\/?a|advert(isement)?|commercial|station\s?id|live stream|loading\.{0,3}|no title|news|weather|traffic)$/i;
const COVER_OR_TRIBUTE = /\b(karaoke|tribute|cover version|instrumental version|originally performed by|as made famous by|remix tribute)\b/i;
const ADLIKE = /\b(advertisement|commercial|sponsor|promo|listen live|news update|traffic|weather|sweeper|station id)\b/i;

export function parseIcyStreamTitle(rawInput: string): ParsedTrack | null {
  const raw = stripRadioNoise(rawInput);
  if (!raw || JUNK_TITLE.test(raw) || ADLIKE.test(raw)) return null;

  for (const sep of [/\s[-–—]\s/, /\s::\s/, /\s\|\s/, /\s\/\s/]) {
    const parts = raw.split(sep).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - '), raw };
  }

  const byMatch = raw.match(/^(.+?)\s+by\s+(.+?)$/i);
  if (byMatch) return { artist: byMatch[2].trim(), title: byMatch[1].trim(), raw };
  return { artist: '', title: raw, raw };
}

export function scoreTrackCandidate(track: ParsedTrack, candidate: Partial<TrackIdentity> & { provider?: string }): { confidence: number; reasons: string[] } {
  const titleSim = similarity(track.title, candidate.title || '');
  const artistSim = track.artist ? similarity(track.artist, candidate.artist || '') : 0;
  let confidence = 0;
  const reasons: string[] = [];

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

  if (candidate.genre) { confidence += 4; reasons.push('catalog genre returned'); }
  if (candidate.artworkUrl) { confidence += 4; reasons.push('catalog artwork returned'); }
  if (candidate.previewUrl) { confidence += 2; reasons.push('preview available'); }
  if (COVER_OR_TRIBUTE.test(`${candidate.artist} ${candidate.title} ${candidate.album || ''}`)) {
    confidence -= 38;
    reasons.push('cover/karaoke/tribute penalty');
  }

  return { confidence: Math.max(0, Math.min(100, confidence)), reasons };
}

function stripRadioNoise(value: string): string {
  return String(value || '')
    .replace(/StreamTitle=/i, '')
    .replace(/^['\"]|['\"];?$/g, '')
    .replace(/\s*\|\s*(live|radio).*$/i, '')
    .replace(/\s*[-–—]\s*(live on .*|\d{2,4}\.?\d?\s?fm|\w+ radio)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function similarity(a: unknown, b: unknown): number {
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
