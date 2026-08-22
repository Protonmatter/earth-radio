// Lightweight station similarity used by the "Similar stations" discovery surface.
// Pure and unit-tested (SPEC-DISCOVERY-001, REQ-DISC-SIMILAR).
import type { Station } from './types';

export function scoreSimilarity(a: Station, b: Station): number {
  if (!a || !b || a.stationuuid === b.stationuuid) return -1;

  let score = 0;
  const aTags = new Set(a.tagList || []);
  for (const tag of b.tagList || []) if (aTags.has(tag)) score += 3;

  if (a.countrycode && a.countrycode === b.countrycode) score += 2;
  else if (a.country && a.country !== 'Unknown' && a.country === b.country) score += 2;

  if (a.codec && a.codec !== 'UNKNOWN' && a.codec === b.codec) score += 1;
  if (a.language && a.language === b.language) score += 1;

  // Gentle tie-break toward higher-quality peers.
  score += Math.min(1, (b.quality?.score || 0) / 100);
  return score;
}

export function rankSimilar(target: Station, candidates: Station[], limit = 12): Station[] {
  return (candidates || [])
    .map(candidate => ({ candidate, score: scoreSimilarity(target, candidate) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.candidate);
}

/** Weighted random pick biased toward higher quality (SPEC-DISCOVERY-001, REQ-DISC-RANDOM). */
export function weightedRandomStation(stations: Station[], random: () => number = Math.random): Station | null {
  const pool = (stations || []).filter(Boolean);
  if (!pool.length) return null;
  const weights = pool.map(station => Math.max(1, (station.quality?.score || 0) + 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = random() * total;
  for (let index = 0; index < pool.length; index += 1) {
    threshold -= weights[index];
    if (threshold <= 0) return pool[index];
  }
  return pool[pool.length - 1];
}
