// Radio domain pack: wires the radio data layer, marker encoding, and selection telemetry
// into the engine. Registers itself as the default pack. See SPEC-ENGINE-001.
import { registerDomainPack } from '../../core/domainPack';
import { t } from '../../core/i18n';
import type { DomainPack, MarkerStyle, Station } from '../../core/types';
import { fetchStations, recordStationClick } from './api';
import './sources.js';

export const radioDomain: DomainPack = {
  id: 'radio',
  label: 'Radio',
  isDefault: true,
  subtitle: t('grid.subtitle'),

  loadEntities(options) {
    return fetchStations(options);
  },

  async recordSelection(station) {
    await recordStationClick(station);
  },

  markerStyle(station: Station): MarkerStyle {
    // Single accent hue; quality is encoded by size + opacity, not heat colors, so the map
    // reads like a product surface rather than a severity map.
    const score = station.quality?.score ?? 0;
    return {
      radius: score >= 80 ? 7 : score >= 60 ? 6 : 5,
      color: '#ffffff',
      weight: 1,
      fillColor: score >= 60 ? '#4f46e5' : '#8b8bf5',
      fillOpacity: score >= 60 ? 0.9 : 0.6
    };
  }
};

registerDomainPack(radioDomain);
