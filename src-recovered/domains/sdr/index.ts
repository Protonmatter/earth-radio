// SDR domain pack (engine-seam proof). Loads public SDR receivers via the proxy and reuses
// the entire engine (map, list, filters, search, favorites). Not the default pack.
import { getRuntimeConfig } from '../../core/config';
import { registerDomainPack } from '../../core/domainPack';
import { summarizeStationSources } from '../../core/sourceGraph.js';
import type { DirectoryResult, DomainPack, MarkerStyle, Station } from '../../core/types';
import { normalizeSdrReceiver } from './normalize';
import './sources.js';

export const sdrDomain: DomainPack = {
  id: 'sdr',
  label: 'SDR receivers',
  subtitle: 'Public software-defined radio receivers you can tune live, by availability.',

  async loadEntities(): Promise<DirectoryResult> {
    const config = getRuntimeConfig();
    if (!config.proxyBaseUrl) return emptyResult();
    try {
      const response = await fetch(`${config.proxyBaseUrl.replace(/\/+$/, '')}/api/sdr/receivers`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const stations = ((payload?.receivers as any[]) || [])
        .map(normalizeSdrReceiver)
        .filter((station): station is Station => Boolean(station));
      return { stations, source: 'sdr', sourceSummary: summarizeStationSources(stations), cached: false, stale: false };
    } catch {
      return emptyResult();
    }
  },

  async recordSelection() {
    /* no upstream click telemetry for SDR receivers */
  },

  markerStyle(station: Station): MarkerStyle {
    const available = station.lastcheckok;
    const score = station.quality?.score ?? 0;
    return {
      radius: score >= 80 ? 7 : 5,
      color: available ? '#1d4ed8' : '#6b7280',
      weight: 1.5,
      fillColor: available ? '#3b82f6' : '#9ca3af',
      fillOpacity: 0.8
    };
  }
};

function emptyResult(): DirectoryResult {
  return { stations: [], source: 'sdr', sourceSummary: summarizeStationSources([]), cached: false, stale: false };
}

registerDomainPack(sdrDomain);
