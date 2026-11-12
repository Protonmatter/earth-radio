import { WORLD_LAND } from './world-land.js?v=0.37.0';
import { MAP_LABEL_STORAGE, sanitizeMapLabels, layoutMapLabels, intersectsBounds, resolveMapTheme } from './map-core.js?v=0.37.0';
import { t, normalizeLocale } from '../i18n/index.js?v=0.37.0';
import {installMapViewport} from './map-viewport.js?v=0.37.0';
import {MAP_COUNTRY_IDENTIFIERS} from './map-country-identifiers.js?v=0.37.0';
import {passportMapCountries,subscribePassportMap} from './passport-map.js?v=0.37.0';

export function identifyAtlasCountries(data, kind, asset) {
  const index = MAP_COUNTRY_IDENTIFIERS[kind];
  // A future dataset cannot accidentally inherit an older ordinal's identity.
  if (!index || index.asset !== asset || index.codes.length !== data?.countries?.features?.length) return data;
  return { ...data, countries: { ...data.countries, features: data.countries.features.map((feature, ordinal) => ({
    ...feature, properties: { ...feature.properties, countrycode: index.codes[ordinal] }
  })) } };
}

// All geography ships with the app. No tile, geocoder or location service is
// used. The runtime retains ownership of the Leaflet map and radio markers.
const dataPromises = new Map();
const controllers = new WeakMap();
const tooltipMaps = new WeakSet();
function installTooltipBounds(map) {
  if (tooltipMaps.has(map)) return;
  tooltipMaps.add(map);
  let element = null, observer = null, queued = false;
  const position = () => {
    queued = false;
    if (!element?.isConnected) return;
    const mapBox = map.getContainer().getBoundingClientRect();
    const left = Math.max(0, mapBox.left) + 8, right = Math.min(innerWidth, mapBox.right) - 8;
    const top = Math.max(0, mapBox.top) + 8, bottom = Math.min(innerHeight, mapBox.bottom) - 8;
    element.style.maxWidth = `${Math.max(0, right - left)}px`;
    element.style.translate = 'none';
    const box = element.getBoundingClientRect();
    const x = box.left < left ? left - box.left : box.right > right ? right - box.right : 0;
    const y = box.top < top ? top - box.top : box.bottom > bottom ? bottom - box.bottom : 0;
    element.style.translate = `${x}px ${y}px`;
    element.toggleAttribute('data-er-clamped', Boolean(x || y));
  };
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(position); } };
  const close = () => {
    observer?.disconnect(); observer = null;
    if (element) { element.style.translate = ''; element.style.maxWidth = ''; element.removeAttribute('data-er-clamped'); }
    element = null;
  };
  const open = event => {
    close();
    const candidate = event.tooltip?.getElement();
    if (!candidate?.classList.contains('er-station-tooltip')) return;
    element = candidate; observer = new ResizeObserver(schedule); observer.observe(element); schedule();
  };
  map.on('tooltipopen', open); map.on('tooltipclose', close);
  map.on('mousemove moveend zoomend resize', schedule);
  map.once('unload', () => {
    close(); map.off('tooltipopen', open); map.off('tooltipclose', close);
    map.off('mousemove moveend zoomend resize', schedule); tooltipMaps.delete(map);
  });
}
function loadData(kind) {
  if (!dataPromises.has(kind)) {
    const loaders = {
      world: () => import('./map-world-b021d4b5.js').then(module => identifyAtlasCountries(module.MAP_WORLD,'world','map-world-b021d4b5.js')),
      detail: () => import('./map-detail-5d713b76.js').then(module => identifyAtlasCountries(module.MAP_DETAIL,'detail','map-detail-5d713b76.js')),
      terrain: () => import('./map-terrain-c2f063b9.js').then(module => module.MAP_TERRAIN),
      roads: () => import('./map-roads-d81fc5ea.js').then(module => module.MAP_ROADS)
    };
    dataPromises.set(kind, loaders[kind]());
  }
  return dataPromises.get(kind);
}

function preferences(map) {
  if (controllers.has(map)) return controllers.get(map);
  let state;
  try { state = sanitizeMapLabels(JSON.parse(localStorage.getItem(MAP_LABEL_STORAGE) || 'null')); }
  catch { state = sanitizeMapLabels(null); }
  const listeners = new Set();
  const removeHandlers = [];
  const options = document.getElementById('er-map-options');
  const handleKey = event => {
    if (event.key !== 'Escape' || !options.open) return;
    event.preventDefault(); event.stopPropagation(); options.open = false; options.querySelector('summary')?.focus();
  };
  options?.addEventListener('keydown', handleKey);
  const closeOptions = event => { if (options?.open && event.target instanceof Node && !options.contains(event.target)) options.open = false; };
  document.addEventListener('pointerdown', closeOptions);
  for (const key of ['countries', 'cities']) {
    const input = document.querySelector(`[data-map-label="${key}"]`);
    if (!input) continue;
    input.checked = state[key];
    const change = () => {
      state = sanitizeMapLabels({ ...state, [key]: input.checked });
      try { localStorage.setItem(MAP_LABEL_STORAGE, JSON.stringify(state)); } catch { /* session-only preferences */ }
      for (const listener of listeners) listener();
    };
    input.addEventListener('change', change);
    removeHandlers.push(() => input.removeEventListener('change', change));
  }
  const localeObserver = new MutationObserver(() => { for (const listener of listeners) listener(); });
  localeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'data-er-palette'] });
  map.once('unload', () => {
    localeObserver.disconnect(); document.removeEventListener('pointerdown', closeOptions);
    options?.removeEventListener('keydown', handleKey); removeHandlers.forEach(remove => remove()); listeners.clear();
    controllers.delete(map);
  });
  const controller = { state: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
  controllers.set(map, controller); return controller;
}

function viewBoxes(map) {
  const bounds = map.getBounds(), south = Math.max(-90, bounds.getSouth()), north = Math.min(90, bounds.getNorth());
  const west = bounds.getWest(), east = bounds.getEast();
  if (east - west >= 360) return [[-180, south, 180, north]];
  const boxes = [];
  for (let shift = -720; shift <= 720; shift += 360) {
    const left = Math.max(-180, west - shift), right = Math.min(180, east - shift);
    if (left <= right) boxes.push([left, south, right, north]);
  }
  return boxes;
}

export function createVectorBasemap(L, map, theme = 'dark') {
  installMapViewport(map);
  installTooltipBounds(map);
  const group = L.layerGroup(), palettes = {
    dark: { water: '#193c39', land: '#34594c', visited: '#657b4e', border: '#779785', river: '#699b99', road: '#af956a', region: '#6a8a7c' },
    light: { water: '#99bcb5', land: '#f0ecdf', visited: '#d5be83', border: '#839e8e', river: '#76a49f', road: '#c5a676', region: '#a4af9d' }
  };
  let renderedTheme = resolveMapTheme(document.documentElement.dataset.erPalette, theme), palette = palettes[renderedTheme];
  for (const [name, depth] of [['erAtlasLand', 200], ['erAtlasWater', 210], ['erAtlasDetail', 230], ['erAtlasLabels', 350]]) {
    if (!map.getPane(name)) { const pane = map.createPane(name); pane.style.zIndex = String(depth); pane.style.pointerEvents = 'none'; }
  }
  map.setMaxZoom(10);
  const baseLayer = L.layerGroup().addTo(group), detailLayer = L.layerGroup().addTo(group), labelsLayer = L.layerGroup().addTo(group);
  let fallback = L.geoJSON(WORLD_LAND, { pane: 'erAtlasLand', interactive: false,
    style: { className: 'er-vector-land', color: palette.border, fillColor: palette.land, fillOpacity: 1, weight: 0.8 }
  }).addTo(baseLayer);
  let active = false, world = null, detail = null, terrain = null, roads = null, timer = 0, lastView = '', baseMode = 'fallback';
  let visitedCountries = new Set(passportMapCountries()), countryPolygons = null;
  function countryStyle(feature) {
    return { className: 'er-vector-land er-map-country', color: palette.border,
      fillColor: visitedCountries.has(feature.properties.countrycode) ? palette.visited : palette.land,
      fillOpacity: 1, weight: map.getZoom() >= 4 ? 0.75 : 0.6 };
  }
  function identifyElement(feature, layer) {
    const element = layer.getElement(); if (!element) return;
    element.dataset.erCountry = feature.properties.countrycode || '';
    element.dataset.erPassportVisited = String(visitedCountries.has(feature.properties.countrycode));
  }
  function updatePassport(codes = passportMapCountries()) {
    visitedCountries = new Set(codes);
    countryPolygons?.setStyle(countryStyle);
    countryPolygons?.eachLayer(layer => identifyElement(layer.feature, layer));
    map.getContainer().dataset.erPassportCountries = [...visitedCountries].sort().join(',');
  }
  const loading = new Set(), errors = new Set(), controller = preferences(map);
  const canvas = L.canvas({ pane: 'erAtlasDetail', padding: 0.2 });
  const notice = document.getElementById('er-map-data-status');
  const noticeText = () => {
    if (!active || !notice) return;
    const locale = normalizeLocale(document.documentElement.lang);
    notice.hidden = !errors.size && !loading.size;
    notice.textContent = errors.size ? t('map.detailUnavailable', undefined, locale) : t('map.loadingDetail', undefined, locale);
  };
  const schedule = () => { if (active && !timer) timer = setTimeout(() => { timer = 0; render(); }, 0); };
  function request(kind) {
    if (loading.has(kind) || errors.has(kind) || (kind === 'world' ? world : kind === 'detail' ? detail : kind === 'terrain' ? terrain : roads)) return;
    loading.add(kind); noticeText();
    loadData(kind).then(data => {
      if (kind === 'world') world = data;
      else if (kind === 'detail') detail = data;
      else if (kind === 'terrain') terrain = data;
      else roads = data;
      lastView = ''; schedule();
    }).catch(() => { errors.add(kind); }).finally(() => { loading.delete(kind); noticeText(); });
  }
  function drawBase() {
    const high = Boolean(detail && map.getZoom() >= 4), mode = high ? 'detail' : world ? 'world' : 'fallback';
    if (mode === baseMode) return;
    baseMode = mode; baseLayer.clearLayers(); fallback = countryPolygons = null;
    const data = high ? detail : world;
    if (!data) return;
    countryPolygons = L.geoJSON(data.countries, { pane: 'erAtlasLand', interactive: false,
      style: countryStyle,
      onEachFeature(feature, layer) { layer.on('add', () => identifyElement(feature, layer)); }
    }).addTo(baseLayer);
    map.getContainer().dataset.erMapDetail = mode;
  }
  function renderLabels() {
    if (!active || !world) return;
    labelsLayer.clearLayers();
    const size = map.getSize(), center = map.getCenter().lng, locale = normalizeLocale(document.documentElement.lang);
    const labels = layoutMapLabels(world.labels, { zoom: map.getZoom(), width: size.x, height: size.y, locale,
      ...controller.state(), project: ([longitude, latitude]) => map.latLngToContainerPoint([latitude, longitude + 360 * Math.round((center - longitude) / 360)])
    });
    for (const entry of labels) {
      const span = document.createElement('span'); span.textContent = entry.name; span.setAttribute('aria-hidden', 'true');
      const longitude = entry.label.point[0] + 360 * Math.round((center - entry.label.point[0]) / 360);
      L.marker([entry.label.point[1], longitude], { pane: 'erAtlasLabels', interactive: false, keyboard: false,
        icon: L.divIcon({ className: `er-geo-label er-geo-${entry.label.kind}`, html: span,
          iconSize: [entry.width, entry.height], iconAnchor: [entry.anchorX, entry.height / 2] })
      }).addTo(labelsLayer);
    }
    const container = map.getContainer();
    container.dataset.erCountryLabels = String(labels.filter(entry => entry.label.kind === 'country').length);
    container.dataset.erCityLabels = String(labels.filter(entry => entry.label.kind === 'city').length);
  }
  function render() {
    if (!active) return;
    const wantedTheme = resolveMapTheme(document.documentElement.dataset.erPalette, theme);
    if (wantedTheme !== renderedTheme) {
      renderedTheme = wantedTheme; palette = palettes[wantedTheme]; lastView = '';
      if (baseMode === 'fallback') fallback?.setStyle({ color: palette.border, fillColor: palette.land });
      else baseMode = '';
    }
    map.getContainer().dataset.erBasemap = renderedTheme;
    const zoom = map.getZoom(), boxes = viewBoxes(map);
    request('world'); if (zoom >= 4) request('detail'); if (zoom >= 5) request('terrain'); if (zoom >= 6) request('roads');
    drawBase(); renderLabels();
    const view = JSON.stringify([zoom, boxes, Boolean(world), Boolean(detail), Boolean(terrain), Boolean(roads)]);
    if (view !== lastView) {
      lastView = view; detailLayer.clearLayers();
      const visible = feature => feature.properties.minZoom <= zoom && boxes.some(box => intersectsBounds(box, feature.properties.bounds));
      const water = zoom >= 4 && detail ? detail.water : world?.water;
      if (water) L.geoJSON({ type: 'FeatureCollection', features: water.features.filter(visible) }, {
        renderer: canvas, interactive: false, style: { color: palette.water, fillColor: palette.water, fillOpacity: 1, weight: 0.5 }
      }).addTo(detailLayer);
      for (const data of [zoom >= 5 && terrain, zoom >= 6 && roads].filter(Boolean)) {
        L.geoJSON({ type: 'FeatureCollection', features: data.lines.features.filter(visible) }, { renderer: canvas, interactive: false,
          style: feature => ({ color: palette[feature.properties.kind], weight: feature.properties.kind === 'road' ? 1.15 : 0.75,
            opacity: feature.properties.kind === 'region' ? 0.65 : 0.8, ...(feature.properties.kind === 'region' ? { dashArray: '3 3' } : {}) })
        }).addTo(detailLayer);
      }
    }
    noticeText();
  }
  let unsubscribe = null, unsubscribePassport = null;
  group.on('add', () => {
    active = true; updatePassport(); unsubscribePassport = subscribePassportMap(updatePassport);
    unsubscribe = controller.subscribe(schedule); map.on('moveend zoomend resize', schedule); render();
  });
  group.on('remove', () => {
    active = false; clearTimeout(timer); timer = 0; unsubscribe?.(); unsubscribePassport?.(); map.off('moveend zoomend resize', schedule);
    if (map.hasLayer(canvas)) map.removeLayer(canvas);
    if (notice) notice.hidden = true;
  });
  map.getContainer().dataset.erMapDetail = 'fallback';
  map.getContainer().dataset.erBasemap = renderedTheme;
  map.attributionControl?.setPrefix(false);
  group.getAttribution = () => 'Made with <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a>';
  return group;
}
