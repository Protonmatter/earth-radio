// Domain-agnostic source-claim + agreement engine, shared by the browser client and the
// Node proxy. Source identifiers are data registered by domain packs (see
// src/domains/<domain>/sources.js); this module hard-codes only neutral defaults.

const sourceWeights = {
  direct: 0.2,
  probe: 0.3,
  import: 0.08,
  unknown: 0.05
};

const sourceLabels = {
  direct: 'Direct endpoint',
  probe: 'Live stream probe',
  import: 'User import',
  unknown: 'Unknown source'
};

const trustedSources = new Set();

/** Domain packs call this to register their source types, labels, and trust tier. */
export function registerSourceTypes({ weights = {}, labels = {}, trusted = [] } = {}) {
  Object.assign(sourceWeights, weights);
  Object.assign(sourceLabels, labels);
  for (const source of trusted) trustedSources.add(source);
}

export function getSourceWeight(source) {
  return Object.prototype.hasOwnProperty.call(sourceWeights, source) ? sourceWeights[source] : sourceWeights.unknown;
}

export function getSourceLabel(source) {
  return sourceLabels[source] || source;
}

export function normalizeSourceClaims(input, fallbackSource = 'unknown') {
  const claims = Array.isArray(input) ? input : [];
  const normalized = claims.map(claim => normalizeSourceClaim(claim)).filter(Boolean);

  if (!normalized.length) {
    normalized.push(normalizeSourceClaim({ source: fallbackSource, confidence: getSourceWeight(fallbackSource) }));
  }

  const bySource = new Map();
  for (const claim of normalized) {
    const existing = bySource.get(claim.source);
    if (!existing || claim.confidence > existing.confidence) bySource.set(claim.source, claim);
  }
  return [...bySource.values()].sort((a, b) => b.confidence - a.confidence || a.source.localeCompare(b.source));
}

export function normalizeSourceClaim(claim) {
  if (!claim || typeof claim !== 'object') return null;
  const source = cleanToken(claim.source || claim.sourceId || 'unknown');
  const sourceId = cleanString(claim.sourceId || claim.id || '', 200);
  const observedAt = isIsoDateString(claim.observedAt || claim.lastSeenAt)
    ? (claim.observedAt || claim.lastSeenAt)
    : new Date().toISOString();
  const confidence = clampNumber(claim.confidence, getSourceWeight(source), 0, 1);
  const method = cleanString(claim.method || '', 80);
  const url = cleanString(claim.url || '', 1000);

  return {
    source,
    label: getSourceLabel(source),
    sourceId,
    confidence: Number(confidence.toFixed(3)),
    observedAt,
    method,
    url
  };
}

export function scoreSourceAgreement(sourceClaims = []) {
  const claims = normalizeSourceClaims(sourceClaims, 'unknown');
  const distinctSources = new Set(claims.map(claim => claim.source));
  const weightedConfidence = claims.reduce((total, claim) => total + claim.confidence, 0);
  const agreementScore = Math.min(1, weightedConfidence);
  const sourceCount = distinctSources.size;

  const reasons = [];
  if (sourceCount > 1) reasons.push(`${sourceCount} source agreement`);
  else reasons.push(`single source: ${claims[0]?.label || 'unknown'}`);

  const trustedClaim = claims.find(claim => trustedSources.has(claim.source));
  if (trustedClaim) reasons.push(`trusted directory claim: ${trustedClaim.label}`);

  return {
    sourceCount,
    agreementScore: Number(agreementScore.toFixed(3)),
    confidenceBonus: Math.round(Math.min(14, agreementScore * 14 + Math.max(0, sourceCount - 1) * 3)),
    reasons,
    sources: claims
  };
}

export function summarizeStationSources(stations = [], explicitSources = null) {
  const counts = new Map();
  const observedAtValues = [];

  for (const station of stations) {
    const claims = normalizeSourceClaims(station.sourceClaims || station.sources, 'unknown');
    for (const claim of claims) {
      counts.set(claim.source, (counts.get(claim.source) || 0) + 1);
      if (isIsoDateString(claim.observedAt)) observedAtValues.push(claim.observedAt);
    }
  }

  const sourceCounts = [...counts.entries()]
    .map(([source, count]) => ({ source, label: getSourceLabel(source), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const enabledSources = Array.isArray(explicitSources) ? explicitSources : sourceCounts.map(item => item.source);
  const label = sourceCounts.length
    ? sourceCounts.map(item => `${item.label}: ${item.count}`).join(' · ')
    : 'No source claims';

  return {
    label,
    sourceCounts,
    enabledSources,
    newestObservationAt: observedAtValues.sort().at(-1) || null,
    stationCount: stations.length
  };
}

export function makeCanonicalStationId(raw) {
  const url = cleanString(raw?.url_resolved || raw?.url || raw?.listen_url || raw?.listenUrl).toLowerCase().replace(/\/+$/, '');
  const name = cleanString(raw?.name || raw?.server_name || raw?.serverName).toLowerCase();
  const country = cleanString(raw?.country || raw?.countrycode || raw?.countryCode).toLowerCase();
  const key = url || [name, country].filter(Boolean).join('|') || cleanString(raw?.stationuuid || raw?.id || raw?.sourceId);
  return key ? `station-${stableHash(key)}` : '';
}

export function stableHash(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cleanToken(value) {
  return cleanString(value, 80).toLowerCase().replace(/[^a-z0-9._-]/g, '-') || 'unknown';
}

function cleanString(value, maxLength = 500) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isIsoDateString(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
