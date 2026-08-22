// Normalizes a public SDR receiver record into the engine's Station shape. Pure and
// unit-tested (tests/unit/sdr.spec.ts). Demonstrates that "radio" is just one entity type.
import { scoreSourceAgreement } from '../../core/sourceGraph.js';
import './sources.js';
import type { Station } from '../../core/types';

export function normalizeSdrReceiver(raw: any): Station | null {
  if (!raw || typeof raw !== 'object') return null;

  const url = cleanString(raw.url || raw.sdr_hw_url || raw.listen_url);
  const name = cleanString(raw.name || raw.sdr_name) || 'SDR receiver';
  if (!isHttpUrl(url)) return null;

  const gps = parseGps(raw.gps || raw.loc || '');
  const lat = Number.isFinite(raw.lat) ? Number(raw.lat) : gps.lat;
  const lng = Number.isFinite(raw.lon) ? Number(raw.lon) : gps.lon;

  const users = parseInt0(raw.users);
  const usersMax = parseInt0(raw.users_max) || 4;
  const freeSlots = Math.max(0, usersMax - users);
  const snr = parseInt0(raw.snr);

  const tagList = [
    cleanString(raw.sdr_hw).toLowerCase(),
    cleanString(raw.antenna).toLowerCase(),
    freeSlots > 0 ? 'available' : 'full'
  ].filter(Boolean).slice(0, 6);

  const sourceClaims = [{
    source: 'kiwisdr',
    sourceId: cleanString(raw.id || url),
    confidence: 0.5,
    observedAt: new Date().toISOString(),
    method: 'directory-ingest',
    url
  }];
  const sourceAgreement = scoreSourceAgreement(sourceClaims);

  // Receiver "quality" ~ availability + reception SNR.
  const score = Math.max(0, Math.min(100, 40 + freeSlots * 8 + Math.min(40, snr)));

  return {
    stationuuid: `sdr-${cleanString(raw.id || url)}`,
    name,
    url,
    url_resolved: url,
    homepage: isHttpUrl(raw.homepage) ? cleanString(raw.homepage) : '',
    favicon: '',
    tags: tagList.join(', '),
    tagList,
    country: cleanString(raw.country) || 'Unknown',
    countrycode: cleanString(raw.countrycode).toUpperCase(),
    language: '',
    codec: 'SDR',
    bitrate: 0,
    clickcount: users,
    votes: 0,
    lastcheckok: freeSlots > 0,
    lastchecktime: '',
    lastcheckoktime: '',
    geo_lat: Number.isFinite(lat) ? lat : null,
    geo_long: Number.isFinite(lng) ? lng : null,
    secureStream: url.startsWith('https://'),
    sourceClaims: sourceAgreement.sources,
    sourceSummary: 'KiwiSDR network',
    sourceAgreement,
    nowPlaying: '',
    streamEndpoint: { url, codec: 'SDR', bitrate: 0, secure: url.startsWith('https://'), status: 'unknown', metadata: null },
    quality: {
      score,
      label: score >= 80 ? 'strong' : score >= 60 ? 'ok' : score >= 40 ? 'weak' : 'poor',
      reasons: [`${freeSlots} free slot(s)`, snr ? `SNR ${snr}` : 'SNR unknown']
    },
    domain: 'sdr'
  };
}

function parseGps(value: string): { lat: number; lon: number } {
  const match = String(value || '').match(/\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/);
  if (!match) return { lat: NaN, lon: NaN };
  return { lat: Number.parseFloat(match[1]), lon: Number.parseFloat(match[2]) };
}

function parseInt0(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function isHttpUrl(value: unknown): boolean {
  try {
    const url = new URL(cleanString(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
