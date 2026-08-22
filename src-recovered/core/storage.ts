// User data (favorites, recents, preferences, playback-failure penalties) persisted in
// IndexedDB but mirrored in memory so the UI can read synchronously. Legacy localStorage
// records migrate on first hydrate. Treats imported data as hostile (see sanitize.ts).
import { dbGet, dbSet } from './db';
import {
  MAX_FAVORITES,
  MAX_RECENTS,
  cleanString,
  limitObjectEntries,
  makeFavoriteRecord,
  sanitizeFavoriteRecords,
  sanitizePreferences,
  summarizeStation
} from './sanitize';
import type { Station } from './types';

export interface Preferences {
  secureOnly: boolean;
  minQuality: number;
  volume: number;
  theme: 'system' | 'light' | 'dark';
  locale: string;
  [key: string]: unknown;
}

interface BadStationRecord {
  failures: number;
  reason: string;
  lastFailureAt: string;
}

const DEFAULT_PREFS: Preferences = {
  secureOnly: false,
  minQuality: 0,
  volume: 0.8,
  theme: 'system',
  locale: 'en'
};

const state = {
  favorites: {} as Record<string, any>,
  recents: [] as any[],
  prefs: { ...DEFAULT_PREFS } as Preferences,
  badStations: {} as Record<string, BadStationRecord>,
  lastPlayed: null as any
};

let hydrated = false;

export async function hydrateStorage(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    state.favorites = (await dbGet<Record<string, any>>('kv', 'favorites')) ?? persistInitial('favorites', migrateFavorites());
    state.recents = (await dbGet<any[]>('kv', 'recents')) ?? persistInitial('recents', migrateRecents());
    state.badStations = (await dbGet<Record<string, BadStationRecord>>('kv', 'badStations')) ?? persistInitial('badStations', migrateBadStations());
    state.lastPlayed = (await dbGet('kv', 'lastPlayed')) ?? persistInitial('lastPlayed', migrateLastPlayed());
    const storedPrefs = (await dbGet<Record<string, unknown>>('kv', 'prefs')) ?? migratePreferences();
    state.prefs = { ...DEFAULT_PREFS, ...(sanitizePreferences(storedPrefs) as Partial<Preferences>) };
    await dbSet('kv', 'prefs', state.prefs);
  } catch {
    // Defaults remain in memory; app still works without persistence.
  }
}

function persist(key: keyof typeof state): void {
  void dbSet('kv', String(key), state[key]);
}

function persistInitial<T>(key: string, value: T): T {
  void dbSet('kv', key, value);
  return value;
}

// ---- Favorites ----

export function getFavorites(): Set<string> {
  return new Set(Object.keys(state.favorites));
}

export function getFavoriteRecords(): Record<string, any> {
  return state.favorites;
}

export function addFavorite(uuid: string, station: Station | null = null): void {
  if (!uuid) return;
  state.favorites[uuid] = makeFavoriteRecord(uuid, station, state.favorites[uuid]);
  persist('favorites');
}

export function removeFavorite(uuid: string): void {
  delete state.favorites[uuid];
  persist('favorites');
}

export function toggleFavorite(uuid: string, station: Station | null = null): boolean {
  if (state.favorites[uuid]) {
    delete state.favorites[uuid];
    persist('favorites');
    return false;
  }
  state.favorites[uuid] = makeFavoriteRecord(uuid, station, state.favorites[uuid]);
  persist('favorites');
  return true;
}

export function isFavorite(uuid: string): boolean {
  return Boolean(state.favorites[uuid]);
}

// ---- Recents / last played ----

export function getLastPlayed(): any {
  return state.lastPlayed;
}

export function setLastPlayed(station: Station): void {
  if (!station) return;
  const summary = summarizeStation(station);
  state.lastPlayed = summary;
  persist('lastPlayed');
  addRecent(summary);
}

export function getRecentStations(limit = 20): any[] {
  return Array.isArray(state.recents) ? state.recents.slice(0, limit) : [];
}

export function clearRecentStations(): void {
  state.recents = [];
  persist('recents');
}

function addRecent(summary: any): void {
  const records = getRecentStations(MAX_RECENTS).filter(item => item.stationuuid !== summary.stationuuid);
  records.unshift({ ...summary, playedAt: new Date().toISOString() });
  state.recents = records.slice(0, 50);
  persist('recents');
}

// ---- Preferences ----

export function getPreferences(): Preferences {
  return { ...state.prefs };
}

export function setPreference(key: string, value: unknown): void {
  const sanitized = sanitizePreferences({ [key]: value });
  if (!(key in sanitized)) return;
  (state.prefs as Record<string, unknown>)[key] = sanitized[key];
  persist('prefs');
}

// ---- Playback failure penalties ----

export function getBadStations(): Map<string, BadStationRecord> {
  return new Map(Object.entries(state.badStations));
}

export function markStationPlaybackFailure(uuid: string, reason = 'playback-error'): void {
  if (!uuid) return;
  const previous = state.badStations[uuid] || { failures: 0, reason: '', lastFailureAt: '' };
  state.badStations[uuid] = {
    failures: previous.failures + 1,
    reason,
    lastFailureAt: new Date().toISOString()
  };
  state.badStations = Object.fromEntries(Object.entries(state.badStations).slice(-500));
  persist('badStations');
}

export function clearStationPlaybackFailure(uuid: string): void {
  if (!uuid || !state.badStations[uuid]) return;
  delete state.badStations[uuid];
  persist('badStations');
}

// ---- Export / import ----

export function exportUserData(): any {
  return {
    schema: 1,
    exportedAt: new Date().toISOString(),
    favorites: state.favorites,
    recent: getRecentStations(MAX_RECENTS),
    preferences: getPreferences()
  };
}

export function importUserData(payload: any): { favoritesImported: number; recentImported: number; preferencesImported: number } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid import payload');
  }

  const report = { favoritesImported: 0, recentImported: 0, preferencesImported: 0 };

  const favorites = sanitizeFavoriteRecords(payload.favorites);
  if (favorites) {
    state.favorites = limitObjectEntries({ ...state.favorites, ...favorites }, MAX_FAVORITES);
    persist('favorites');
    report.favoritesImported = Object.keys(favorites).length;
  }

  if (Array.isArray(payload.recent)) {
    state.recents = payload.recent
      .map((item: any) => summarizeStation(item))
      .filter((item: any) => item.stationuuid)
      .slice(0, MAX_RECENTS);
    persist('recents');
    report.recentImported = state.recents.length;
  }

  const preferences = sanitizePreferences(payload.preferences);
  if (Object.keys(preferences).length > 0) {
    state.prefs = { ...state.prefs, ...(preferences as Partial<Preferences>) };
    persist('prefs');
    report.preferencesImported = Object.keys(preferences).length;
  }

  if (!report.favoritesImported && !report.recentImported && !report.preferencesImported) {
    throw new Error('Import file did not contain favorites, recent stations, or preferences');
  }

  return report;
}

// ---- Legacy localStorage migration (best effort, runs once) ----

function readLegacyJson(key: string): any {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function migrateFavorites(): Record<string, any> {
  const current = readLegacyJson('earthRadio.favorites.v2');
  const sanitized = current && typeof current === 'object' && !Array.isArray(current) ? sanitizeFavoriteRecords(current) : null;
  if (sanitized) return sanitized;

  const legacy = readLegacyJson('radio.favorites');
  if (Array.isArray(legacy)) {
    const migrated: Record<string, any> = {};
    for (const uuid of legacy.slice(0, MAX_FAVORITES)) {
      const cleanUuid = cleanString(uuid, 160);
      if (cleanUuid) migrated[cleanUuid] = makeFavoriteRecord(cleanUuid);
    }
    return migrated;
  }
  return {};
}

function migrateRecents(): any[] {
  const recents = readLegacyJson('earthRadio.recent.v1');
  return Array.isArray(recents) ? recents.slice(0, MAX_RECENTS) : [];
}

function migratePreferences(): Record<string, unknown> {
  const prefs = readLegacyJson('earthRadio.preferences.v1');
  return prefs && typeof prefs === 'object' ? prefs : {};
}

function migrateBadStations(): Record<string, BadStationRecord> {
  const bad = readLegacyJson('earthRadio.badStations.v1');
  return bad && typeof bad === 'object' && !Array.isArray(bad) ? bad : {};
}

function migrateLastPlayed(): any {
  return readLegacyJson('earthRadio.lastPlayed.v2') || readLegacyJson('radio.lastPlayed') || null;
}
