// Background reachability check. Probes a bounded set of stations through the proxy and
// marks unreachable ones so the UI can dim them and auto-skip can avoid them. Opportunistic
// and cached; only runs when a proxy is configured (desktop or proxy deployments).
import { getRuntimeConfig } from './config';
import { probeStationStream } from './streamProbe';
import type { Station } from './types';

const unreachable = new Set<string>();
const probed = new Set<string>();
let running = false;

export function isUnreachable(uuid: string): boolean {
  return unreachable.has(uuid);
}

export function getUnreachable(): Set<string> {
  return unreachable;
}

export async function runHealthProbe(
  stations: Station[],
  { limit = 60, concurrency = 4, onUpdate }: { limit?: number; concurrency?: number; onUpdate?: () => void } = {}
): Promise<void> {
  const config = getRuntimeConfig();
  if (!config.proxyBaseUrl || running) return;

  const queue = (stations || []).filter(station => !probed.has(station.stationuuid)).slice(0, limit);
  if (!queue.length) return;

  running = true;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      const station = queue[cursor++];
      probed.add(station.stationuuid);
      try {
        const observation = await probeStationStream(station);
        // A null result (proxy 502 / timeout) or an explicit not-ok means unreachable.
        if (!observation || observation.ok === false) {
          if (!unreachable.has(station.stationuuid)) {
            unreachable.add(station.stationuuid);
            onUpdate?.();
          }
        }
      } catch {
        // ignore individual probe failures
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  } finally {
    running = false;
  }
}
