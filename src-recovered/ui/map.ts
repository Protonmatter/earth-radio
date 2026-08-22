// Leaflet map with clustered, incrementally-updated markers. CSS is bundled (not CDN) for
// supply-chain control. Clusters and the "now playing" beacon use branded markup so the map
// reads like a product surface, not a data-viz heat map.
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import type { MarkerStyle, Station } from '../core/types';

export interface MapHandlers {
  onStationClick?: (station: Station) => void;
  onCountrySelect?: (country: string) => void;
  markerStyle?: (station: Station) => MarkerStyle;
}

let map: L.Map | null = null;
let cluster: L.MarkerClusterGroup | null = null;
let tileLayer: L.TileLayer | null = null;
let playingMarker: L.Marker | null = null;
const markers = new Map<string, L.CircleMarker>();
let onStationClick: ((station: Station) => void) | null = null;
let onCountrySelect: ((country: string) => void) | null = null;
let styleFor: (station: Station) => MarkerStyle = defaultMarkerStyle;

export function initMap(containerId: string, stations: Station[], handlers: MapHandlers = {}): void {
  onStationClick = handlers.onStationClick ?? null;
  onCountrySelect = handlers.onCountrySelect ?? null;
  if (handlers.markerStyle) styleFor = handlers.markerStyle;

  if (map) {
    updateMapMarkers(stations);
    return;
  }

  map = L.map(containerId, {
    center: [25, 5],
    zoom: 2,
    minZoom: 2,
    zoomControl: true,
    attributionControl: true,
    worldCopyJump: true
  });

  // Zoom control moves to the right so it never sits under the now-playing sidecar.
  map.zoomControl?.setPosition('topright');

  applyTiles(currentTheme());

  cluster = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 55,
    iconCreateFunction: createClusterIcon
  });
  map.addLayer(cluster);
  map.on('popupopen', wirePopupActions);
  updateMapMarkers(stations);
}

export function updateMapMarkers(stations: Station[]): void {
  if (!cluster) return;

  const next = new Map<string, Station>();
  for (const station of stations || []) {
    if (stationLatLng(station)) next.set(station.stationuuid, station);
  }

  const toRemove: L.CircleMarker[] = [];
  for (const [uuid, marker] of markers) {
    if (!next.has(uuid)) {
      toRemove.push(marker);
      markers.delete(uuid);
    }
  }
  if (toRemove.length) cluster.removeLayers(toRemove);

  const toAdd: L.CircleMarker[] = [];
  for (const [uuid, station] of next) {
    const existing = markers.get(uuid);
    if (existing) {
      applyStyle(existing, station);
      continue;
    }
    const coords = stationLatLng(station);
    if (!coords) continue;
    const marker = L.circleMarker(coords, styleFor(station));
    marker.bindPopup(renderPopup(station));
    marker.on('click', () => onStationClick?.(station));
    markers.set(uuid, marker);
    toAdd.push(marker);
  }
  if (toAdd.length) cluster.addLayers(toAdd);
}

/**
 * Mark the currently-playing station: drop a pulsing beacon at its location and fly the map
 * to it. Passing null clears the beacon. This is what makes the map relevant to playback.
 */
export function setPlayingStation(station: Station | null): void {
  if (!map) return;

  if (playingMarker) {
    map.removeLayer(playingMarker);
    playingMarker = null;
  }
  if (!station) return;

  // No real coordinates → don't drop a beacon or fly (avoids the "null island" off Africa).
  const coords = stationLatLng(station);
  if (!coords) return;
  const [lat, lng] = coords;

  playingMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: 'er-beacon-icon',
      html: '<span class="er-beacon"><span class="er-beacon-core"></span></span>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    }),
    zIndexOffset: 1000,
    keyboard: false,
    interactive: false
  });
  playingMarker.addTo(map);

  const targetZoom = Math.max(map.getZoom(), 5);
  map.flyTo([lat, lng], targetZoom, { animate: true, duration: 0.7 });
}

/** Pan to a station and open its popup (used for non-playback focus). */
export function highlightMapMarker(stationUuid: string): void {
  const marker = markers.get(stationUuid);
  if (!marker || !map) return;
  map.panTo(marker.getLatLng(), { animate: true, duration: 0.5 });
  marker.openPopup();
}

export function getMapInstance(): L.Map | null {
  return map;
}

export function setMapTheme(theme: 'light' | 'dark'): void {
  if (map) applyTiles(theme);
}

function createClusterIcon(clusterLayer: L.MarkerCluster): L.DivIcon {
  const count = clusterLayer.getChildCount();
  const bucket = count < 10 ? 's' : count < 100 ? 'm' : count < 1000 ? 'l' : 'xl';
  const size = count < 10 ? 34 : count < 100 ? 40 : count < 1000 ? 48 : 56;
  return L.divIcon({
    html: `<div class="er-cluster er-cluster--${bucket}"><span>${formatCount(count)}</span></div>`,
    className: 'er-cluster-icon',
    iconSize: L.point(size, size)
  });
}

function formatCount(count: number): string {
  if (count >= 1000) return `${Math.round(count / 100) / 10}k`;
  return String(count);
}

function applyTiles(theme: 'light' | 'dark'): void {
  if (!map) return;
  if (tileLayer) {
    map.removeLayer(tileLayer);
    tileLayer = null;
  }
  const variant = theme === 'dark' ? 'dark_all' : 'light_all';
  tileLayer = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png`, {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  });
  tileLayer.addTo(map);
}

function currentTheme(): 'light' | 'dark' {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyStyle(marker: L.CircleMarker, station: Station): void {
  const style = styleFor(station);
  marker.setStyle(style);
  marker.setRadius(style.radius);
}

function wirePopupActions(event: L.PopupEvent): void {
  const element = event.popup.getElement();
  const button = element?.querySelector<HTMLButtonElement>('.popup-country-btn');
  if (!button) return;
  button.addEventListener(
    'click',
    () => {
      const country = button.dataset.country || '';
      if (country) onCountrySelect?.(country);
    },
    { once: true }
  );
}

function renderPopup(station: Station): string {
  const meta = [station.country, station.codec, station.bitrate ? `${station.bitrate} kbps` : '', station.quality?.label]
    .filter(Boolean)
    .map(escapeHtml)
    .join(' · ');

  const tags = station.tagList?.length
    ? `<div class="popup-station-tags">${station.tagList.slice(0, 4).map(tag => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';

  const countryBtn = station.country && station.country !== 'Unknown'
    ? `<button type="button" class="popup-country-btn" data-country="${escapeHtml(station.country)}">Explore ${escapeHtml(station.country)}</button>`
    : '';

  return `
    <div class="popup-station">
      <strong>${escapeHtml(station.name)}</strong><br />
      <span class="popup-station-meta">${meta}</span>
      ${tags}
      ${countryBtn}
    </div>
  `;
}

function defaultMarkerStyle(station: Station): MarkerStyle {
  const score = station.quality?.score ?? 0;
  return {
    radius: score >= 80 ? 7 : 5,
    color: '#ffffff',
    weight: 1,
    fillColor: score >= 60 ? '#4f46e5' : '#8b8bf5',
    fillOpacity: 0.85
  };
}

// Reject missing coordinates. Radio Browser reports unknown locations as null (which
// Number(null) would coerce to 0) or literal 0/0, both of which map to the ocean off West
// Africa — so we treat them as "no location" instead of plotting/flying there.
function stationLatLng(station: Station): [number, number] | null {
  if (station.geo_lat == null || station.geo_long == null) return null;
  const lat = Number(station.geo_lat);
  const lng = Number(station.geo_long);
  return isValidLatLng(lat, lng) ? [lat, lng] : null;
}

function isValidLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
