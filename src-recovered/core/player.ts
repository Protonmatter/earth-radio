// Audio state machine. Crash-proof playback with HLS support, playlist resolution,
// Media Session integration, bounded reconnect, and stall detection. See SPEC-PLAYBACK-001.
import { getRuntimeConfig } from './config';
import { firstPlayableUrl, isHlsUrl, isPlaylistUrl } from './playlist.js';
import type { Station } from './types';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'ended';

export interface PlayerCallbacks {
  onStateChange?: (status: PlayerStatus, station: Station | null) => void;
  onStationChange?: (station: Station | null) => void;
  onCanPlay?: (station: Station | null) => void;
  onError?: (station: Station | null, error: Error) => void;
  onEnded?: (station: Station | null) => void;
  onVolumeChange?: (volume: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
}

const MAX_RECONNECTS = 2;
const STALL_TIMEOUT_MS = 12_000;
// Time a freshly-selected stream gets to start before we treat it as unavailable and
// auto-skip. Reachable streams (incl. HLS) start within ~2-4s; unreachable hosts just hang.
const CONNECT_TIMEOUT_MS = 6_000;

/** Pure helpers (unit-tested) for SPEC-PLAYBACK-001 REQ-PLAY-NOCRASH / REQ-PLAY-AUTOSKIP. */
export function classifyPlaybackError(code: number | undefined): 'transient' | 'fatal' {
  return code === 2 ? 'transient' : 'fatal'; // MEDIA_ERR_NETWORK is recoverable
}

export function shouldAutoSkip(autoSkipEnabled: boolean, visibleCount: number): boolean {
  return Boolean(autoSkipEnabled) && visibleCount > 1;
}

/** REQ-PLAY-RECONNECT: bounded exponential backoff schedule for transient drops. */
export function reconnectDelayMs(attempt: number): number {
  return 800 * 2 ** Math.max(0, attempt - 1);
}

export function canReconnect(attempt: number, max: number = MAX_RECONNECTS): boolean {
  return attempt < max;
}

export interface MediaSessionMetadataInit {
  title: string;
  artist: string;
  album: string;
  artwork: { src: string; sizes: string; type: string }[];
}

/** REQ-PLAY-MEDIA: build the Media Session metadata for a station (pure, testable). */
export function buildMediaSessionMetadata(station: Station): MediaSessionMetadataInit {
  return {
    title: station.name || 'Unknown Station',
    artist: station.country || '',
    album: 'Earth Radio',
    artwork: station.favicon ? [{ src: station.favicon, sizes: '512x512', type: 'image/png' }] : []
  };
}

let audio: HTMLAudioElement | null = null;
let hls: { destroy(): void; loadSource(url: string): void; attachMedia(el: HTMLMediaElement): void; on(event: unknown, cb: (e: unknown, data: unknown) => void): void } | null = null;
let currentStation: Station | null = null;
let status: PlayerStatus = 'idle';
let callbacks: PlayerCallbacks = {};
let errorCount = 0;
let intendedPlaying = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stallTimer: ReturnType<typeof setTimeout> | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let hasPlayedCurrent = false;
let loadToken = 0;

export function initPlayer(next: PlayerCallbacks = {}): void {
  audio = document.getElementById('audio-player') as HTMLAudioElement | null;
  if (!audio) {
    console.error('Audio element not found');
    return;
  }
  callbacks = next || {};
  audio.preload = 'none';

  audio.addEventListener('loadstart', () => setStatus('loading'));
  audio.addEventListener('canplay', () => {
    errorCount = 0;
    reconnectAttempts = 0;
    clearStallTimer();
    clearConnectTimer();
    callbacks.onCanPlay?.(currentStation);
  });
  audio.addEventListener('playing', () => {
    hasPlayedCurrent = true;
    clearStallTimer();
    clearConnectTimer();
    setStatus('playing');
  });
  audio.addEventListener('pause', () => setStatus(audio?.ended ? 'ended' : 'paused'));
  audio.addEventListener('ended', () => {
    setStatus('ended');
    callbacks.onEnded?.(currentStation);
  });
  audio.addEventListener('waiting', () => armStallTimer());
  audio.addEventListener('stalled', () => armStallTimer());
  audio.addEventListener('error', () => handleMediaError());
  audio.addEventListener('volumechange', () => callbacks.onVolumeChange?.(audio!.volume));
}

export async function playStation(station: Station | null): Promise<boolean> {
  if (!audio || !station) return false;
  if (!(station.url_resolved || station.url)) return false;

  const isNewStation = !currentStation || currentStation.stationuuid !== station.stationuuid;
  currentStation = station;
  intendedPlaying = true;

  if (isNewStation) {
    reconnectAttempts = 0;
    callbacks.onStationChange?.(station);
    updateMediaSession(station);

    const token = ++loadToken;
    hasPlayedCurrent = false;
    setStatus('loading');
    armConnectTimer();
    teardownHls();
    audio.pause();
    audio.removeAttribute('src');

    const playable = await resolvePlayableUrl(station);
    if (token !== loadToken) return false; // a newer selection superseded this load

    try {
      await attachSource(playable);
    } catch (error) {
      handleFatalError(error as Error);
      return false;
    }
  }

  return startPlayback();
}

export async function togglePlay(): Promise<boolean> {
  if (!audio) return false;
  if (!currentStation && !audio.src) return false;

  if (audio.paused) {
    intendedPlaying = true;
    return startPlayback();
  }
  pause();
  return true;
}

export function pause(): void {
  if (!audio) return;
  intendedPlaying = false;
  clearTimers();
  audio.pause();
  setStatus('paused');
  setMediaSessionState('paused');
}

export function stop(): void {
  if (!audio) return;
  intendedPlaying = false;
  clearTimers();
  teardownHls();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  setStatus('idle');
}

export function setVolume(value: number | string): void {
  if (!audio) return;
  const parsed = Number.parseFloat(String(value));
  if (Number.isFinite(parsed)) audio.volume = Math.min(1, Math.max(0, parsed));
}

export function getCurrentStation(): Station | null {
  return currentStation;
}

export function getPlaybackStatus(): PlayerStatus {
  return status;
}

export function isPlayingNow(): boolean {
  return status === 'playing' || status === 'loading';
}

export function getErrorCount(): number {
  return errorCount;
}

export async function playNext(stations: Station[]): Promise<Station | null> {
  const station = getRelativeStation(stations, 1);
  if (station) await playStation(station);
  return station;
}

export async function playPrev(stations: Station[]): Promise<Station | null> {
  const station = getRelativeStation(stations, -1);
  if (station) await playStation(station);
  return station;
}

/** Push a live now-playing title into the Media Session metadata. */
export function setNowPlayingMetadata(title: string): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession.metadata) return;
  try {
    navigator.mediaSession.metadata.title = title;
  } catch {
    // MediaMetadata is read-only in some engines; ignore.
  }
}

async function startPlayback(): Promise<boolean> {
  if (!audio) return false;
  try {
    await audio.play();
    hasPlayedCurrent = true;
    clearConnectTimer();
    setStatus('playing');
    setMediaSessionState('playing');
    return true;
  } catch (error) {
    setStatus('error');
    callbacks.onError?.(currentStation, error as Error);
    return false;
  }
}

async function attachSource(url: string): Promise<void> {
  if (!audio) return;
  const nativeHls = audio.canPlayType('application/vnd.apple.mpegurl') !== '';

  if (isHlsUrl(url) && !nativeHls) {
    const { default: Hls } = await import('hls.js');
    if (Hls.isSupported()) {
      const instance = new Hls({ enableWorker: true, lowLatencyMode: false });
      instance.on(Hls.Events.ERROR, (_event: unknown, data: { fatal?: boolean }) => {
        if (data?.fatal) handleHlsFatal();
      });
      instance.loadSource(url);
      instance.attachMedia(audio);
      hls = instance as unknown as typeof hls;
      return;
    }
  }

  audio.src = url;
  audio.load();
}

async function resolvePlayableUrl(station: Station): Promise<string> {
  const raw = station.url_resolved || station.url;
  if (!isPlaylistUrl(raw)) return raw;

  const config = getRuntimeConfig();
  if (config.proxyBaseUrl) {
    try {
      const endpoint = `${config.proxyBaseUrl.replace(/\/+$/, '')}/api/streams/resolve?url=${encodeURIComponent(raw)}`;
      const response = await fetchWithTimeout(endpoint, Math.min(config.apiTimeoutMs, 6000));
      const data = await response.json();
      if (data?.url) return String(data.url);
    } catch {
      // fall through to client-side resolution
    }
  }

  try {
    const response = await fetchWithTimeout(raw, 6000);
    const text = await response.text();
    const resolved = firstPlayableUrl(text, response.headers.get('content-type') || '');
    if (resolved) return resolved;
  } catch {
    // give up; let the audio element attempt the container URL directly
  }

  return raw;
}

function getRelativeStation(stations: Station[], offset: number): Station | null {
  if (!Array.isArray(stations) || stations.length === 0) return null;
  if (!currentStation) return stations[0];
  const index = stations.findIndex(station => station.stationuuid === currentStation!.stationuuid);
  const nextIndex = index >= 0 ? (index + offset + stations.length) % stations.length : 0;
  return stations[nextIndex];
}

function handleMediaError(): void {
  const code = audio?.error?.code;
  // Only reconnect a stream that actually started playing then dropped (transient network).
  // A stream that never connected is treated as unavailable so auto-skip happens promptly.
  if (intendedPlaying && hasPlayedCurrent && classifyPlaybackError(code) === 'transient' && canReconnect(reconnectAttempts)) {
    scheduleReconnect();
    return;
  }
  handleFatalError(getAudioError());
}

function handleHlsFatal(): void {
  if (intendedPlaying && hasPlayedCurrent && canReconnect(reconnectAttempts)) {
    scheduleReconnect();
    return;
  }
  handleFatalError(new Error('hls-fatal'));
}

function handleFatalError(error: Error): void {
  errorCount += 1;
  clearTimers();
  setStatus('error');
  callbacks.onError?.(currentStation, error);
}

function scheduleReconnect(): void {
  reconnectAttempts += 1;
  clearStallTimer();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = reconnectDelayMs(reconnectAttempts);
  setStatus('loading');
  reconnectTimer = setTimeout(() => void reattach(), delay);
}

async function reattach(): Promise<void> {
  if (!audio || !currentStation || !intendedPlaying) return;
  const token = ++loadToken;
  teardownHls();
  try {
    const playable = await resolvePlayableUrl(currentStation);
    if (token !== loadToken) return;
    await attachSource(playable);
    await audio.play();
    setStatus('playing');
  } catch (error) {
    handleFatalError(error as Error);
  }
}

function armStallTimer(): void {
  if (!intendedPlaying) return;
  clearStallTimer();
  stallTimer = setTimeout(() => {
    if (intendedPlaying && status !== 'playing') {
      if (canReconnect(reconnectAttempts)) scheduleReconnect();
      else handleFatalError(new Error('stalled'));
    }
  }, STALL_TIMEOUT_MS);
}

function clearStallTimer(): void {
  if (stallTimer) {
    clearTimeout(stallTimer);
    stallTimer = null;
  }
}

// Watchdog: if a freshly-selected stream never reaches "playing", treat it as unavailable
// so the UI doesn't sit on a spinner waiting for a slow/absent media error event.
function armConnectTimer(): void {
  clearConnectTimer();
  connectTimer = setTimeout(() => {
    if (intendedPlaying && !hasPlayedCurrent && status !== 'playing') {
      handleFatalError(new Error('connect-timeout'));
    }
  }, CONNECT_TIMEOUT_MS);
}

function clearConnectTimer(): void {
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
}

function clearTimers(): void {
  clearStallTimer();
  clearConnectTimer();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function teardownHls(): void {
  if (hls) {
    try {
      hls.destroy();
    } catch {
      // ignore
    }
    hls = null;
  }
}

function updateMediaSession(station: Station): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata(buildMediaSessionMetadata(station));
    navigator.mediaSession.setActionHandler('play', () => void togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => callbacks.onPrev?.());
    navigator.mediaSession.setActionHandler('nexttrack', () => callbacks.onNext?.());
  } catch {
    // MediaMetadata unavailable; non-fatal.
  }
}

function setMediaSessionState(state: 'playing' | 'paused' | 'none'): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    // ignore
  }
}

function setStatus(next: PlayerStatus): void {
  if (status === next) return;
  status = next;
  callbacks.onStateChange?.(status, currentStation);
}

function getAudioError(): Error {
  const code = audio?.error?.code;
  const labels: Record<number, string> = { 1: 'aborted', 2: 'network', 3: 'decode', 4: 'unsupported' };
  return new Error(code ? labels[code] || 'playback-error' : 'playback-error');
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
