import { buildFacetOptions, coordinates, pickStation, rankStations, sanitizePreferences } from './discovery-core.js?v=0.30.0';
import { createMapDirectory, mergeMappedStations } from './map-directory.js?v=0.30.0';
import { installSearchControls } from './search-controls.js?v=0.30.0';
import { getLocale, t } from '../i18n/index.js?v=0.30.0';

// A hidden-to-visible resize can leave Leaflet's animated bounds correction
// running. Its moveend handler can start another correction while stop() fires.
// Suspend that handler through the public bounds API for this synchronous action,
// then restore the same bounds against the final view. No drag limits are lost.
export function settledMapAction(map, action) {
  const bounds = map.options.maxBounds;
  map.setMaxBounds(null);
  try {
    map.stop();
    map.invalidateSize({ pan: false });
    return action();
  } finally { map.setMaxBounds(bounds); }
}

// Adapter contract is documented in docs/DISCOVERY.md. This module owns only
// discovery state, never playback, persisted account records, or runtime routes.
export function installDiscovery(adapter) {
  const root = document.getElementById('er-discovery');
  if (!root) return { ownsSearch: false, augment: stations => stations, transform: stations => stations, options: () => ({}), observe() {}, clear() {}, explainButton: () => document.createTextNode('') };
  root.dataset.searchAuthority = 'discovery';
  let prefs = sanitizePreferences(null), bounds = null, entries = new Map(), facetSource = null;
  let timer = 0, composing = false, refreshQueued = false;
  const health = new Map();
  const query = root.querySelector('[name="query"]');
  const advanced = root.querySelector('details');
  const compact = matchMedia('(max-width: 767px), (max-height: 600px)');
  advanced.open = !compact.matches;
  compact.addEventListener('change', event => { advanced.open = !event.matches; });
  const status = document.getElementById('er-discovery-status');
  const focus = document.getElementById('er-map-focus');
  const area = document.getElementById('er-map-area');
  const mapSearch = document.getElementById('er-map-search');
  const mapNotice = document.getElementById('er-map-directory-status');
  const directory = createMapDirectory();
  let mapStations = [], mapSnapshot = null, augmented = null, mapGeneration = 0, mapState = 'idle';
  const dialog = document.getElementById('er-station-detail');
  const detailTitle = dialog.querySelector('h2');
  const detailMeta = dialog.querySelector('[data-detail-meta]');
  const detailReasons = dialog.querySelector('ul');
  const detailPlay = dialog.querySelector('[data-detail-play]');
  let detailStation = null;
  const context = () => ({ ...prefs, bounds, health, ...adapter.context(), locale: getLocale() });
  const controls = installSearchControls(root, {
    preferences: () => prefs, context, readControls,
    patchFilters: patch => adapter.patchFilters(patch),
    showAll: () => adapter.showAll(),
    hasArea: () => Boolean(bounds), clearArea: () => { clearArea(); refresh(); },
    reset: () => {
      clear();
      adapter.patchFilters({ countries: [], tags: [], bitrates: [], secureOnly: false, minQuality: 0 }, false);
      adapter.showAll();
    }
  });

  function refresh() { adapter.refresh(); }
  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => { refreshQueued = false; refresh(); });
  }
  function clear() {
    document.dispatchEvent(new CustomEvent('earthradio:discovery-reset'));
    clearTimeout(timer); root.reset(); prefs = sanitizePreferences(null); clearArea();
  }
  function clearArea() {
    mapGeneration++; directory.cancel(); bounds = null; area.hidden = true;
    mapState = 'idle'; mapNotice.hidden = true; mapSearch.disabled = !adapter.allowDirectory();
  }
  function readControls() {
    const data = Object.fromEntries(new FormData(root));
    prefs = sanitizePreferences({ ...data, secureOnly: data.secureOnly === 'on', avoidFailures: data.avoidFailures === 'on' });
    refresh();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(readControls, 140); }
  query.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
  query.addEventListener('compositionend', () => { composing = false; schedule(); });
  query.addEventListener('input', () => { if (!composing) schedule(); });
  // Enhanced text inputs are presentation only. Their blur/change must not
  // redraw (and remove) a chip between pointerdown and click.
  root.addEventListener('change', event => { if (event.target !== query && event.target.name && root.elements.namedItem(event.target.name) === event.target) { clearTimeout(timer); readControls(); } });
  root.addEventListener('submit', event => { event.preventDefault(); clearTimeout(timer); readControls(); });
  document.addEventListener('earthradio:country-selected', event => {
    if (event.detail?.source !== 'search') return;
    clearArea();
    adapter.patchFilters({ countries: event.detail.country ? [event.detail.country] : [] });
  });
  mapSearch.addEventListener('click', async () => {
    if (!adapter.allowDirectory()) { mapSearch.disabled = true; return; }
    const map = adapter.map();
    if (!map) return;
    const box = settledMapAction(map, () => map.getBounds());
    bounds = { south: box.getSouth(), north: box.getNorth(), west: box.getWest(), east: box.getEast() };
    adapter.prepareArea();
    area.hidden = false;
    const generation = ++mapGeneration;
    mapState = 'loading'; mapNotice.hidden = false; mapNotice.textContent = 'Loading more stations around the world…';
    mapSearch.disabled = true; refresh();
    try {
      const result = await directory.load();
      if (generation !== mapGeneration) return;
      if (mapSnapshot !== result) {
        const normalized = [];
        for (const record of result.stations) {
          // Optional upstream metadata can be malformed even when identity and
          // location are valid. One bad record must not discard its neighbors.
          try { const station = adapter.normalize(record); if (station) normalized.push(station); } catch { /* invalid directory record */ }
        }
        mapStations = normalized;
        mapSnapshot = result;
        augmented = null;
      }
      mapState = 'loaded'; refresh();
    } catch {
      if (generation === mapGeneration) {
        mapState = 'error'; mapNotice.textContent = 'Could not load more mapped stations. Showing loaded stations; tap Search this area to retry.';
      }
    } finally { if (generation === mapGeneration) mapSearch.disabled = false; }
  });
  area.addEventListener('click', () => { clearArea(); refresh(); });
  document.getElementById('er-map-fit').addEventListener('click', () => {
    const map = adapter.map(), points = adapter.visible().map(coordinates).filter(Boolean);
    if (!map) return;
    settledMapAction(map, () => {
      if (points.length) map.fitBounds(points, { padding: [48, 64], maxZoom: 6, animate: false });
      else map.setView([25, 5], 2);
    });
  });
  focus.addEventListener('click', () => {
    const point = coordinates(adapter.current());
    if (point) adapter.map()?.setView(point, 5, { animate: !matchMedia('(prefers-reduced-motion: reduce)').matches });
  });
  document.getElementById('er-discovery-pick').addEventListener('click', () => {
    const pick = pickStation(adapter.visible(), { ...context(), current: adapter.current(), secureOnly: location.protocol === 'https:' || prefs.secureOnly });
    if (pick) adapter.play(pick);
    else status.textContent = 'No alternative stations match. Reset discovery to broaden the selection.';
  });
  function showDetails(id) {
    const entry = entries.get(id);
    if (!entry) return;
    detailStation = entry.station;
    detailTitle.textContent = entry.station.name;
    detailMeta.textContent = [entry.station.country, entry.station.language, entry.station.codec,
      entry.station.bitrate ? `${entry.station.bitrate} kbps` : 'Bitrate unknown'].filter(Boolean).join(' · ');
    detailReasons.replaceChildren(...entry.reasons.map(reason => { const li = document.createElement('li'); li.textContent = reason; return li; }));
    dialog.showModal();
  }
  dialog.querySelector('[data-detail-close]').addEventListener('click', () => dialog.close());
  detailPlay.addEventListener('click', () => { if (detailStation) adapter.play(detailStation); dialog.close(); });
  function updatePlayingControls() {
    root.dataset.directoryAllowed = String(adapter.allowDirectory());
    root.querySelector('[data-search-country]').disabled = !adapter.allowDirectory();
    focus.disabled = !coordinates(adapter.current());
    root.querySelector('option[value="similar"]').disabled = !adapter.current();
    mapSearch.disabled = !adapter.allowDirectory() || mapState === 'loading';
  }
  let previousStation = null;
  window.addEventListener('earthradio:station-selected', () => {
    updatePlayingControls();
    const id = adapter.current()?.stationuuid;
    if (prefs.sort === 'similar' && id !== previousStation) queueRefresh();
    previousStation = id;
  });
  window.addEventListener('earthradio:stations-load-settled', updatePlayingControls);

  function updateFacets(stations) {
    if (facetSource === stations) return;
    facetSource = stations;
    for (const name of ['genre', 'language']) {
      const select = root.elements.namedItem(name);
      const values = buildFacetOptions(stations, name);
      const selected = prefs[name];
      if (selected && !values.some(option => option.value === selected)) values.push({ value: selected, label: select.selectedOptions[0]?.textContent || selected, count: 0 });
      select.replaceChildren(new Option(t(name === 'genre' ? 'discovery.allGenres' : 'discovery.allLanguages'), ''), ...values.map(({value, label, count}) => {
        const option = new Option(label, value); option.dataset.count = String(count); return option;
      }));
      select.value = selected;
    }
  }

  return {
    ownsSearch: true,
    augment(stations) {
      if (!adapter.allowDirectory() || !mapStations.length || stations === augmented) return stations;
      augmented = mergeMappedStations(stations, mapStations);
      return augmented;
    },
    transform(stations, { all, view }) {
      updateFacets(all);
      const result = rankStations(stations, { ...context(), current: adapter.current() });
      // Recent is a chronology; default discovery must not silently reorder it.
      if ((view === 'recent' || view === 'similar') && prefs.sort === 'best' && !prefs.query) {
        const order = new Map(stations.map((station, index) => [station.stationuuid, index]));
        result.sort((a, b) => order.get(a.station.stationuuid) - order.get(b.station.stationuuid));
      }
      entries = new Map(result.map(entry => [entry.station.stationuuid, entry]));
      const mode = prefs.sort === 'best' ? 'Best match' : prefs.sort === 'explore' ? 'Explore' : prefs.sort === 'reliable' ? 'Reliability' : prefs.sort === 'bitrate' ? 'Highest bitrate' : prefs.sort === 'similar' ? 'Similar genres' : 'A–Z';
      status.textContent = `${result.length.toLocaleString()} matches · ${mode}${bounds ? ' · Map area' : ''}`;
      const mapped = result.filter(entry => coordinates(entry.station)).length;
      if (mapState === 'loaded') mapNotice.textContent = mapped
        ? `${mapped.toLocaleString()} mapped ${mapped === 1 ? 'station matches' : 'stations match'}${bounds ? ' this area and your filters' : ''}.${mapSnapshot.limited ? ' Global sample: 10,000 stations.' : ''}`
        : 'No mapped stations match this area and your filters. Zoom out, reset filters or clear the map area.';
      document.getElementById('er-map-count').textContent = `${mapped.toLocaleString()} located · ${result.length - mapped} without coordinates`;
      updatePlayingControls();
      controls.render(result.length);
      document.dispatchEvent(new CustomEvent('earthradio:discovery-changed', { detail: { query: prefs.query, filters: context().filters, view } }));
      return result.map(entry => entry.station);
    },
    explainButton(station) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'er-discovery-why';
      button.dataset.discoveryWhy = station.stationuuid;
      button.textContent = 'Details ↗'; button.setAttribute('aria-label', `Why this station: ${station.name}`);
      button.addEventListener('click', event => { event.stopPropagation(); showDetails(station.stationuuid); });
      return button;
    },
    options: context,
    clear,
    observe(station, ok) {
      if (!station?.stationuuid) return;
      const record = health.get(station.stationuuid) ?? { successes: 0, failures: 0 };
      health.set(station.stationuuid, { successes: Math.min(1000, record.successes + (ok ? 1 : 0)), failures: Math.min(1000, record.failures + (ok ? 0 : 1)) });
      if (health.size > 500) health.delete(health.keys().next().value);
      // The runtime writes its failure record synchronously after this callback;
      // refresh on the next microtask so the filter reads that committed record.
      if (!ok && (prefs.avoidFailures || prefs.sort === 'reliable')) queueRefresh();
    }
  };
}
