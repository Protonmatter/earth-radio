// Pure radio normalization, quality scoring, and filtering. No storage/DOM/network, so it
// is unit-testable in isolation (tests/unit/api.normalize.spec.ts, filters.spec.ts).
import { normalizeSourceClaims, scoreSourceAgreement } from '../../core/sourceGraph.js';
import './sources.js';
import type { Quality, Station } from '../../core/types';

export interface BitrateBucket {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
}

export const BITRATE_BUCKETS: readonly BitrateBucket[] = Object.freeze([
  { id: 'unknown', label: 'Unknown', min: null, max: null },
  { id: '0-64', label: '0–64 kbps', min: 0, max: 64 },
  { id: '65-128', label: '65–128 kbps', min: 65, max: 128 },
  { id: '129-192', label: '129–192 kbps', min: 129, max: 192 },
  { id: '193-320', label: '193–320 kbps', min: 193, max: 320 },
  { id: '321+', label: '321+ kbps', min: 321, max: null }
]);

interface QualityInput {
  bitrate: number;
  codec: string;
  secureStream: boolean;
  lastcheckok: boolean;
  votes: number;
  clickcount: number;
  hasGeo: boolean;
  localPenalty: number;
  sourceAgreement?: { confidenceBonus?: number; reasons?: string[] };
}

export function scoreStationQuality(station: QualityInput): Quality {
  const reasons: string[] = [];
  let score = 40;

  if (station.lastcheckok) {
    score += 22;
    reasons.push('recent directory check passed');
  } else {
    score -= 18;
    reasons.push('last directory check did not pass');
  }

  if (station.secureStream) {
    score += 10;
    reasons.push('HTTPS stream');
  } else {
    score -= 10;
    reasons.push('HTTP stream may be blocked on HTTPS sites');
  }

  if (station.bitrate >= 128) {
    score += 10;
    reasons.push('bitrate ≥128 kbps');
  } else if (station.bitrate > 0) {
    score += 4;
    reasons.push('low but declared bitrate');
  } else {
    score -= 5;
    reasons.push('unknown bitrate');
  }

  if (station.codec && station.codec !== 'UNKNOWN') {
    score += 8;
    reasons.push(`codec ${station.codec}`);
  } else {
    score -= 8;
    reasons.push('unknown codec');
  }

  if (station.hasGeo) score += 4;
  if (station.votes > 0) score += Math.min(6, Math.log10(station.votes + 1) * 3);
  if (station.clickcount > 0) score += Math.min(6, Math.log10(station.clickcount + 1) * 2);
  if (station.sourceAgreement) {
    score += station.sourceAgreement.confidenceBonus || 0;
    reasons.push(...(station.sourceAgreement.reasons || []));
  }

  if (station.localPenalty > 0) {
    score -= Math.min(28, station.localPenalty * 7);
    reasons.push(`local playback failures: ${station.localPenalty}`);
  }

  const rounded = Math.round(Math.max(0, Math.min(100, score)));
  return {
    score: rounded,
    label: rounded >= 80 ? 'strong' : rounded >= 60 ? 'ok' : rounded >= 40 ? 'weak' : 'poor',
    reasons
  };
}

export function normalizeStation(raw: any, badStations: Map<string, { failures: number }> = new Map()): Station | null {
  if (!raw || typeof raw !== 'object') return null;

  const stationuuid = cleanString(raw.stationuuid || raw.changeuuid || raw.url || raw.name);
  const name = cleanString(raw.name);
  const urlResolved = cleanString(raw.url_resolved || raw.url);
  const url = cleanString(raw.url || raw.url_resolved);

  if (!stationuuid || !name || !isHttpUrl(urlResolved || url)) return null;

  const tags = parseTags(raw.tags);
  const bitrate = parsePositiveInt(raw.bitrate);
  const clickcount = parsePositiveInt(raw.clickcount);
  const votes = parsePositiveInt(raw.votes);
  const codec = cleanString(raw.codec).toUpperCase() || 'UNKNOWN';
  const country = cleanString(raw.country) || 'Unknown';
  const countrycode = cleanString(raw.countrycode).toUpperCase();
  const language = cleanString(raw.language);
  const homepage = isHttpUrl(raw.homepage) ? cleanString(raw.homepage) : '';
  const lastcheckok = Number(raw.lastcheckok) === 1;
  const lastchecktime = cleanString(raw.lastchecktime);
  const lastcheckoktime = cleanString(raw.lastcheckoktime);
  const geo_lat = parseFiniteNumber(raw.geo_lat);
  const geo_long = parseFiniteNumber(raw.geo_long);
  const secureStream = (urlResolved || url).startsWith('https://');
  const localPenalty = badStations.get(stationuuid)?.failures || 0;
  const sourceClaims = normalizeSourceClaims(raw.sourceClaims || raw.sources, raw.source || raw.sourceId || 'radio-browser');
  const sourceAgreement = scoreSourceAgreement(sourceClaims);
  const nowPlaying = cleanString(raw.nowPlaying || raw.current_song || raw.currentSong);

  const quality = scoreStationQuality({
    bitrate,
    codec,
    secureStream,
    lastcheckok,
    votes,
    clickcount,
    hasGeo: Number.isFinite(geo_lat as number) && Number.isFinite(geo_long as number),
    localPenalty,
    sourceAgreement
  });

  return {
    stationuuid,
    name,
    url,
    url_resolved: urlResolved || url,
    homepage,
    favicon: isHttpUrl(raw.favicon) ? cleanString(raw.favicon) : '',
    tags: tags.join(', '),
    tagList: tags,
    country,
    countrycode,
    language,
    codec,
    bitrate,
    clickcount,
    votes,
    lastcheckok,
    lastchecktime,
    lastcheckoktime,
    geo_lat,
    geo_long,
    secureStream,
    sourceClaims,
    sourceSummary: sourceClaims.map(claim => claim.label).join(', '),
    sourceAgreement,
    nowPlaying,
    streamEndpoint: {
      url: urlResolved || url,
      codec,
      bitrate,
      secure: secureStream,
      status: lastcheckok ? 'ok' : 'unknown',
      metadata: nowPlaying ? { streamTitle: nowPlaying, observedAt: new Date().toISOString() } : null
    },
    quality,
    domain: 'radio'
  };
}

export interface StationFilters {
  query?: string;
  countries?: string[];
  tags?: string[];
  bitrates?: string[];
  favoritesOnly?: boolean;
  favoriteUuids?: Set<string>;
  secureOnly?: boolean;
  minQuality?: number;
}

export function filterStations(stations: Station[], filters: StationFilters = {}): Station[] {
  const {
    query = '',
    countries = [],
    tags = [],
    bitrates = [],
    favoritesOnly = false,
    favoriteUuids = new Set<string>(),
    secureOnly = false,
    minQuality = 0
  } = filters;

  const queryLower = query.toLowerCase().trim();
  const countrySet = new Set(countries);
  const tagSet = new Set(tags.map(tag => tag.toLowerCase()));
  const bitrateSet = new Set(bitrates);

  return (stations || []).filter(station => {
    if (favoritesOnly && !favoriteUuids.has(station.stationuuid)) return false;
    if (secureOnly && !station.secureStream) return false;
    if ((station.quality?.score ?? 0) < minQuality) return false;
    if (countrySet.size && !countrySet.has(station.country || 'Unknown')) return false;

    if (tagSet.size) {
      const stationTags = station.tagList || parseTags(station.tags);
      if (!stationTags.some(tag => tagSet.has(tag))) return false;
    }

    if (bitrateSet.size && !bitrateSet.has(getBitrateBucketId(station.bitrate))) return false;

    if (queryLower) {
      const haystack = [station.name, station.country, station.countrycode, station.language, station.codec, station.tags, station.sourceSummary, station.nowPlaying]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(queryLower)) return false;
    }

    return true;
  });
}

export function getBitrateBucketId(bitrate: unknown): string {
  const value = Number.parseInt(String(bitrate), 10);
  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  const bucket = BITRATE_BUCKETS.find(candidate => {
    if (candidate.id === 'unknown') return false;
    const minOk = candidate.min === null || value >= candidate.min;
    const maxOk = candidate.max === null || value <= candidate.max;
    return minOk && maxOk;
  });
  return bucket?.id || 'unknown';
}

export function getBitrateBucketLabel(bucketId: string): string {
  return BITRATE_BUCKETS.find(bucket => bucket.id === bucketId)?.label || bucketId;
}

export function getTopCountries(stations: Station[], limit = 30): { country: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const station of stations || []) {
    const value = cleanString(station.country) || 'Unknown';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country))
    .slice(0, limit);
}

export function getTopTags(stations: Station[], limit = 30): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const station of stations || []) {
    const unique = new Set(station.tagList || parseTags(station.tags));
    for (const tag of unique) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

export function parseTags(value: unknown): string[] {
  if (!value) return [];
  return [...new Set(String(value)
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .filter(tag => tag.length >= 2 && tag.length <= 40))]
    .slice(0, 20);
}

function parsePositiveInt(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

export function isHttpUrl(value: unknown): boolean {
  try {
    const url = new URL(cleanString(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
