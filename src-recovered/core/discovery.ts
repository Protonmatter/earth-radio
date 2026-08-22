// Pure discovery helpers (map drilldown, surprise, similar, recents view). Unit-tested in
// tests/unit/discovery.spec.ts and similar.spec.ts. See SPEC-DISCOVERY-001.
import { rankSimilar, weightedRandomStation } from './similar';
import type { Station } from './types';

export interface Collection {
  id: string;
  label: string;
  tags: string[];
}

/** REQ-DISC-COLLECTIONS: one-tap curated genre entry points. */
export const CURATED_COLLECTIONS: readonly Collection[] = Object.freeze([
  { id: 'jazz', label: 'Jazz', tags: ['jazz'] },
  { id: 'news', label: 'News', tags: ['news'] },
  { id: 'classical', label: 'Classical', tags: ['classical'] },
  { id: 'electronic', label: 'Electronic', tags: ['electronic'] },
  { id: 'rock', label: 'Rock', tags: ['rock'] },
  { id: 'chill', label: 'Chill', tags: ['lounge', 'chillout', 'ambient'] },
  { id: 'pop', label: 'Pop', tags: ['pop'] },
  { id: 'talk', label: 'Talk', tags: ['talk'] }
]);

export function collectionFilter(collection: Collection): { tags: string[] } {
  return { tags: [...collection.tags] };
}

/** REQ-DISC-MAP: a country selection narrows the directory to that country. */
export function countrySelection(country: string): { countries: string[] } {
  return { countries: country && country !== 'Unknown' ? [country] : [] };
}

/** REQ-DISC-RANDOM: quality-weighted random pick. */
export function surpriseStation(stations: Station[], random: () => number = Math.random): Station | null {
  return weightedRandomStation(stations, random);
}

/** REQ-DISC-SIMILAR: rank similar stations. */
export function similarStations(target: Station, all: Station[], limit = 12): Station[] {
  return rankSimilar(target, all, limit);
}

/**
 * REQ-DISC-SKIP: after a playback failure, choose the next station to try. Prefer one
 * similar (genre/region) to the failed station, excluding known-bad stations; fall back to
 * the next non-bad station in the list, then any non-bad station.
 */
export function nextStationAfterFailure(failed: Station, stations: Station[], badIds: Set<string> = new Set()): Station | null {
  const bad = new Set(badIds);
  bad.add(failed.stationuuid);

  const pool = (stations || []).filter(station => !bad.has(station.stationuuid));
  if (!pool.length) return null;

  const [mostSimilar] = rankSimilar(failed, pool, 1);
  if (mostSimilar) return mostSimilar;

  const index = stations.findIndex(station => station.stationuuid === failed.stationuuid);
  for (let offset = 1; offset <= stations.length; offset += 1) {
    const candidate = stations[(index + offset + stations.length) % stations.length];
    if (candidate && !bad.has(candidate.stationuuid)) return candidate;
  }
  return pool[0];
}

/**
 * REQ-DISC-RECENT: build a recently-played view, preferring live station objects from the
 * current directory and falling back to the stored summary so history survives reloads.
 */
export function recentStationsView(records: any[], directory: Station[]): Station[] {
  const byId = new Map(directory.map(station => [station.stationuuid, station]));
  const result: Station[] = [];
  const seen = new Set<string>();
  for (const record of records || []) {
    const id = record?.stationuuid;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const live = byId.get(id);
    if (live) result.push(live);
    else if (record.url_resolved) result.push(summaryToStation(record));
  }
  return result;
}

function summaryToStation(record: any): Station {
  return {
    stationuuid: record.stationuuid,
    name: record.name || 'Unknown Station',
    url: record.url_resolved || '',
    url_resolved: record.url_resolved || '',
    homepage: '',
    favicon: record.favicon || '',
    tags: record.tags || '',
    tagList: String(record.tags || '').split(',').map((tag: string) => tag.trim()).filter(Boolean),
    country: record.country || 'Unknown',
    countrycode: record.countrycode || '',
    language: '',
    codec: record.codec || 'UNKNOWN',
    bitrate: Number(record.bitrate) || 0,
    clickcount: 0,
    votes: 0,
    lastcheckok: true,
    lastchecktime: '',
    lastcheckoktime: '',
    geo_lat: null,
    geo_long: null,
    secureStream: Boolean(record.secureStream),
    sourceClaims: [],
    sourceSummary: '',
    sourceAgreement: { sourceCount: 1, agreementScore: 0, confidenceBonus: 0, reasons: [], sources: [] },
    nowPlaying: '',
    streamEndpoint: {
      url: record.url_resolved || '',
      codec: record.codec || 'UNKNOWN',
      bitrate: Number(record.bitrate) || 0,
      secure: Boolean(record.secureStream),
      status: 'unknown',
      metadata: null
    },
    quality: record.quality || { score: 0, label: 'weak', reasons: [] },
    domain: 'radio'
  };
}
