export const APP_VERSION = '0.24.0-recovered.1';

export interface RuntimeConfig {
  appName: string;
  proxyBaseUrl: string;
  stationLimit: number;
  stationCacheTtlMs: number;
  apiTimeoutMs: number;
  autoSkipOnPlaybackError: boolean;
  preferSecureStreams: boolean;
  useFederatedIndex: boolean;
  enabledSources: string[];
  streamProbeEnabled: boolean;
  nowPlayingEnabled: boolean;
}

export const DEFAULT_CONFIG: Readonly<RuntimeConfig> = Object.freeze({
  appName: 'Earth Radio',
  proxyBaseUrl: '',
  stationLimit: 4000,
  stationCacheTtlMs: 6 * 60 * 60 * 1000,
  apiTimeoutMs: 8000,
  autoSkipOnPlaybackError: true,
  preferSecureStreams: true,
  useFederatedIndex: true,
  enabledSources: ['radio-browser', 'icecast-yp'],
  streamProbeEnabled: true,
  nowPlayingEnabled: true
});

export const DIRECT_RADIO_BROWSER_BASES: readonly string[] = Object.freeze([
  'https://all.api.radio-browser.info',
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info'
]);

declare global {
  interface Window {
    RADIO_CONFIG?: Partial<RuntimeConfig>;
    earthRadio?: {
      isDesktop: boolean;
      getProxy: () => Promise<string>;
      setProxy: (url: string) => Promise<string>;
    };
  }
}

export function getRuntimeConfig(): Readonly<RuntimeConfig> {
  const runtime =
    typeof window !== 'undefined' && window.RADIO_CONFIG && typeof window.RADIO_CONFIG === 'object'
      ? window.RADIO_CONFIG
      : {};

  return Object.freeze({
    ...DEFAULT_CONFIG,
    ...runtime,
    stationLimit: clampInteger(runtime.stationLimit, DEFAULT_CONFIG.stationLimit, 100, 5000),
    stationCacheTtlMs: clampInteger(runtime.stationCacheTtlMs, DEFAULT_CONFIG.stationCacheTtlMs, 60_000, 7 * 24 * 60 * 60 * 1000),
    apiTimeoutMs: clampInteger(runtime.apiTimeoutMs, DEFAULT_CONFIG.apiTimeoutMs, 1500, 30_000),
    useFederatedIndex: runtime.useFederatedIndex !== false,
    streamProbeEnabled: runtime.streamProbeEnabled !== false,
    nowPlayingEnabled: runtime.nowPlayingEnabled !== false,
    enabledSources: sanitizeSourceList(runtime.enabledSources, DEFAULT_CONFIG.enabledSources)
  });
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeSourceList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const allowed = new Set(['radio-browser', 'icecast-yp', 'radioplayer', 'shoutcast', 'direct']);
  const sanitized = value
    .map(item => String(item || '').trim().toLowerCase())
    .filter(item => allowed.has(item));
  return sanitized.length ? sanitized : fallback;
}
