// Continuous now-playing client. Subscribes to the proxy's Server-Sent Events stream of ICY
// StreamTitle updates and maintains a per-session history. See SPEC-NOWPLAYING-001.
import { getRuntimeConfig } from './config';
import type { Station } from './types';

export interface NowPlayingCallbacks {
  onTitle?: (title: string, history: string[]) => void;
}

let source: EventSource | null = null;
let history: string[] = [];

export function startNowPlaying(station: Station | null, callbacks: NowPlayingCallbacks = {}): void {
  stopNowPlaying();
  const config = getRuntimeConfig();
  const url = station?.url_resolved || station?.url;
  if (!config.nowPlayingEnabled || !config.proxyBaseUrl || !url) return;
  if (typeof EventSource === 'undefined') return;

  history = [];
  const endpoint = `${trimTrailingSlash(config.proxyBaseUrl)}/api/streams/nowplaying?url=${encodeURIComponent(url)}`;

  try {
    source = new EventSource(endpoint);
  } catch {
    source = null;
    return;
  }

  source.addEventListener('message', event => {
    try {
      const data = JSON.parse((event as MessageEvent).data);
      const title = String(data?.streamTitle || '').trim();
      if (!title) return;
      pushHistory(title);
      callbacks.onTitle?.(title, getNowPlayingHistory());
    } catch {
      // Ignore malformed metadata frames.
    }
  });

  // EventSource reconnects automatically; nothing to do on error beyond letting it retry.
  source.onerror = () => {};
}

export function stopNowPlaying(): void {
  source?.close();
  source = null;
}

export function getNowPlayingHistory(): string[] {
  return [...history];
}

/** Pure history merge (newest-first, de-duplicated, capped). Unit-tested for REQ-NP-HISTORY. */
export function mergeNowPlayingHistory(current: string[], title: string, max = 30): string[] {
  const clean = String(title || '').trim();
  if (!clean || current[0] === clean) return current;
  return [clean, ...current.filter(item => item !== clean)].slice(0, max);
}

function pushHistory(title: string): void {
  history = mergeNowPlayingHistory(history, title);
}

function trimTrailingSlash(value: string): string {
  return String(value || '').replace(/\/+$/, '');
}
