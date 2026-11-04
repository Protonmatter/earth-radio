import { WORLD_LAND } from './world-land.js';

// Reuses the shipped Leaflet engine, but performs no tile or provider requests.
// The entire basemap is part of the versioned application shell.
export function createVectorBasemap(L, map, theme = 'dark') {
  const paneName = 'erAtlasLand';
  if (!map.getPane(paneName)) {
    const pane = map.createPane(paneName);
    pane.style.zIndex = '200';
    pane.style.pointerEvents = 'none';
  }
  const dark = theme === 'dark';
  const group = L.layerGroup();
  const grid = { pane: paneName, interactive: false, color: dark ? '#3b676a' : '#86a8a0', weight: 0.6, opacity: 0.4 };
  for (let longitude = -180; longitude <= 180; longitude += 30) L.polyline([[-85, longitude], [85, longitude]], grid).addTo(group);
  for (let latitude = -60; latitude <= 60; latitude += 30) L.polyline([[latitude, -180], [latitude, 180]], grid).addTo(group);
  L.geoJSON(WORLD_LAND, {
    pane: paneName, interactive: false,
    style: { className: 'er-vector-land', color: dark ? '#648981' : '#7b9d88', fillColor: dark ? '#244b46' : '#c7d5b9', fillOpacity: 1, opacity: 0.9, weight: 0.8 }
  }).addTo(group);
  map.getContainer().dataset.erBasemap = theme;
  map.attributionControl?.setPrefix(false);
  group.getAttribution = () => 'Made with <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a>';
  return group;
}
