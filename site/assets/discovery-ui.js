import { coordinates, fold, pickStation, rankStations, sanitizePreferences } from './discovery-core.js';
import { createMapDirectory, mergeMappedStations } from './map-directory.js';

// Adapter contract is documented in docs/DISCOVERY.md. This module owns only
// discovery state, never playback, persisted account records, or runtime routes.
export function installDiscovery(adapter) {
  const root = document.getElementById('er-discovery');
  if (!root) return { augment: stations => stations, transform: stations => stations, options: () => ({}), observe() {}, clear() {}, explainButton: () => document.createTextNode('') };
  let prefs = sanitizePreferences(null), bounds = null, entries = new Map(), facetSource = null;
  let timer = 0, composing = false, refreshQueued = false;
  const health = new Map();
  const query = root.querySelector('[name="query"]');
  const advanced = root.querySelector('details');
  const compact = matchMedia('(max-width: 767px)');
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
  const context = () => ({ ...prefs, bounds, health, ...adapter.context() });

  function refresh() { adapter.refresh(); }
  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => { refreshQueued = false; refresh(); });
  }
  function clear() {
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
  root.addEventListener('change', event => { if (event.target !== query) { clearTimeout(timer); readControls(); } });
  root.addEventListener('submit', event => { event.preventDefault(); clearTimeout(timer); readControls(); });
  root.querySelector('[data-discovery-reset]').addEventListener('click', () => {
    clear(); refresh(); query.focus();
  });
  mapSearch.addEventListener('click', async () => {
    if (!adapter.allowDirectory()) { mapSearch.disabled = true; return; }
    const map = adapter.map();
    if (!map) return;
    const box = map.getBounds();
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
    if (points.length) map.fitBounds(points, { padding: [48, 64], maxZoom: 6, animate: false });
    else map.setView([25, 5], 2);
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
    for (const [name, allLabel, values] of [
      ['genre', 'All genres', stations.flatMap(s => s.tagList ?? String(s.tags ?? '').split(','))],
      ['language', 'All languages', stations.flatMap(s => String(s.language ?? '').split(/[,;]+/))]
    ]) {
      const select = root.elements.namedItem(name);
      const unique = [...new Set(values.map(value => fold(value)).filter(Boolean))].sort();
      const selected = prefs[name];
      if (selected && !unique.includes(selected)) unique.push(selected);
      select.replaceChildren(...[['', allLabel], ...unique.map(value => [value, value])].map(([value, label]) => new Option(label, value)));
      select.value = selected;
    }
  }

  return {
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
