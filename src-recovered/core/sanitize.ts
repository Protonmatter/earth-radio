// Pure sanitizers for hostile user/import input. No storage or DOM access, so these are
// unit-testable in isolation (see tests/unit/storage.spec.ts).

export const MAX_STRING_LENGTH = 500;
export const MAX_FAVORITES = 1000;
export const MAX_RECENTS = 100;

const ALLOWED_THEMES = new Set(['system', 'light', 'dark']);

export function cleanString(value: unknown, maxLength = MAX_STRING_LENGTH): string {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

export function sanitizeInteger(value: unknown, min: number, max: number): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

export function isIsoDateString(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function sanitizePreferences(input: any): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const result: Record<string, unknown> = {};
  if ('secureOnly' in input) result.secureOnly = Boolean(input.secureOnly);
  if ('minQuality' in input) {
    const parsed = Number.parseInt(input.minQuality, 10);
    if (Number.isFinite(parsed)) result.minQuality = Math.max(0, Math.min(90, Math.round(parsed / 10) * 10));
  }
  if ('volume' in input) {
    const parsed = Number.parseFloat(input.volume);
    if (Number.isFinite(parsed)) result.volume = Math.max(0, Math.min(1, parsed));
  }
  if ('theme' in input) {
    const theme = String(input.theme || '').toLowerCase();
    if (ALLOWED_THEMES.has(theme)) result.theme = theme;
  }
  if ('locale' in input) {
    const locale = cleanString(input.locale, 12).toLowerCase().replace(/[^a-z-]/g, '');
    if (locale) result.locale = locale;
  }
  return result;
}

export function sanitizeQuality(quality: any): { score: number; label: string; reasons: string[] } | null {
  if (!quality || typeof quality !== 'object') return null;
  return {
    score: sanitizeInteger(quality.score, 0, 100),
    label: cleanString(quality.label, 32) || 'unknown',
    reasons: Array.isArray(quality.reasons)
      ? quality.reasons.map((reason: unknown) => cleanString(reason, 160)).filter(Boolean).slice(0, 10)
      : []
  };
}

export function summarizeStation(station: any): any {
  if (!station || typeof station !== 'object') return {};
  return {
    stationuuid: cleanString(station.stationuuid || station.uuid, 160),
    name: cleanString(station.name, 160) || 'Unknown Station',
    country: cleanString(station.country, 120) || 'Unknown',
    countrycode: cleanString(station.countrycode, 4).toUpperCase(),
    tags: cleanString(station.tags, 500),
    codec: cleanString(station.codec, 32).toUpperCase() || 'UNKNOWN',
    bitrate: sanitizeInteger(station.bitrate, 0, 10000),
    url_resolved: cleanString(station.url_resolved || station.url, MAX_STRING_LENGTH),
    favicon: cleanString(station.favicon, MAX_STRING_LENGTH),
    secureStream: Boolean(station.secureStream),
    quality: sanitizeQuality(station.quality)
  };
}

export function makeFavoriteRecord(uuid: string, station: any = null, previous: any = null): any {
  const cleanUuid = cleanString(uuid, 160);
  return {
    uuid: cleanUuid,
    addedAt: isIsoDateString(previous?.addedAt) ? previous.addedAt : new Date().toISOString(),
    station: station ? summarizeStation(station) : previous?.station ? summarizeStation(previous.station) : null
  };
}

export function sanitizeFavoriteRecords(input: any): Record<string, any> | null {
  if (!input || typeof input !== 'object') return null;

  const result: Record<string, any> = {};
  const entries: [string, any][] = Array.isArray(input)
    ? input.map((uuid: string) => [uuid, { uuid }])
    : Object.entries(input);

  for (const [key, value] of entries.slice(0, MAX_FAVORITES)) {
    const uuid = cleanString(value?.uuid || key, 160);
    if (!uuid) continue;
    const addedAt = isIsoDateString(value?.addedAt) ? value.addedAt : new Date().toISOString();
    result[uuid] = {
      uuid,
      addedAt,
      station: value?.station ? summarizeStation(value.station) : null
    };
  }

  return result;
}

export function limitObjectEntries<T>(object: Record<string, T>, limit: number): Record<string, T> {
  return Object.fromEntries(Object.entries(object).slice(-limit));
}
