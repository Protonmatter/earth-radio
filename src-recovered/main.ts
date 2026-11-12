import './style.css';
// Maintained modules are shared with the shipped runtime; this evidence snapshot still has no rebuild toolchain.
import { installDiscovery } from '../site/assets/discovery-ui.js';
import { directorySnapshotStatus } from '../site/assets/directory-status.js';
import { createStationFacts, updatePlayerFacts } from '../site/assets/place-ui.js';
import { t as translate } from '../site/i18n/index.js';
import { createUserTransfer } from '../site/assets/user-transfer.js';
import './domains/radio/index';
import './domains/sdr/index';

import { APP_VERSION, getRuntimeConfig } from './core/config';
import {
  clearStationPlaybackFailure,
  exportUserData,
  getBadStations,
  getFavorites,
  getLastPlayed,
  getPreferences,
  getRecentStations,
  hydrateStorage,
  prepareUserDataImport,
  applyImportedUserData,
  isFavorite,
  markStationPlaybackFailure,
  setLastPlayed,
  setPreference,
  toggleFavorite
} from './core/storage';
import {
  getCurrentStation,
  getPlaybackStatus,
  initPlayer,
  isPlayingNow,
  pause,
  getRelativeStation,
  playStation,
  setNowPlayingMetadata,
  setVolume,
} from './core/player';
import { showToast } from './core/toast';
import { getMapInstance, initMap, setMapTheme, setPlayingStation, updateMapMarkers } from './ui/map';
import { initNowPlayingPanel, setNowPlayingCountryFacts, setNowPlayingTrack, showNowPlayingStation } from './ui/nowPlayingPanel';
import { getCountryFacts, identifyTrack, parseNowPlaying } from './core/enrich';
import { closeSearch, initSearch, openSearch, updateSearchStations } from './ui/search';
import {
  closeFilters,
  getActiveFilters,
  initFilters,
  openFilters,
  resetFilters,
  setFilterState
} from './ui/filters';
import { closeSettings, initSettings } from './ui/settings';
import { filterStations, normalizeStation } from './domains/radio/normalize';
import { probeStationStream } from './core/streamProbe';
import { getUnreachable, isUnreachable, runHealthProbe } from './core/healthProbe';
import { startNowPlaying, stopNowPlaying } from './core/nowPlaying';
import { cycleTheme, initTheme } from './core/theme';
import { applyDocumentLocale, setLocale, t } from './core/i18n';
import { onRouteChange, readRoute, writeRoute, type RouteState } from './core/router';
import { CURATED_COLLECTIONS, collectionFilter, countrySelection, nextStationAfterFailure, recentStationsView, similarStations, surpriseStation } from './core/discovery';
import { getActiveDomain, setActiveDomain } from './core/domainPack';
import { VirtualGrid } from './ui/virtualList';
import { byId, countryCodeToFlag, createEl } from './ui/dom';
import { icon } from './ui/icons';
import { stableHash } from './core/sourceGraph.js';
import type { DomainPack, Station } from './core/types';

type View = 'all' | 'favorites' | 'recent' | 'similar';

const ROW_HEIGHT = 88;
const CARD_GAP = 12;
// A single reading column, including when the map is collapsed.
const MIN_COLUMN_WIDTH = 1_000_000;
const MAX_AUTO_SKIPS = 8;

let allStations: Station[] = [];
let currentStations: Station[] = [];
let view: View = 'all';
let similarTarget: Station | null = null;
let activeStationUuid: string | null = null;
let sleepTimerId: ReturnType<typeof setTimeout> | null = null;
let featureModulesReady = false;
let grid: VirtualGrid<Station> | null = null;
let autoSkipCount = 0;

const config = getRuntimeConfig();
let activePack: DomainPack = getActiveDomain()!;

const gridEl = byId('station-grid');
const collectionsEl = byId('collections');
const emptyStateEl = byId('empty-state');
const gridTitleEl = byId('grid-title');
const gridSubtitleEl = byId<HTMLElement>('grid-subtitle');
const gridCountEl = byId('grid-count');
const statusLineEl = byId('status-line');
const playerStationEl = byId('player-station');
const playerMetaEl = byId('player-meta');
const btnPlay = byId<HTMLButtonElement>('btn-play');
const btnPrev = byId<HTMLButtonElement>('btn-prev');
const btnNext = byId<HTMLButtonElement>('btn-next');
const btnFavorite = byId<HTMLButtonElement>('btn-favorite');
const btnSimilar = byId<HTMLButtonElement>('btn-similar');
const btnSleep = byId<HTMLButtonElement>('btn-sleep');
const sleepMenu = byId('sleep-menu');
const volumeSlider = byId<HTMLInputElement>('volume');
const favoritesToggle = byId<HTMLButtonElement>('favorites-toggle');
const recentToggle = byId<HTMLButtonElement>('recent-toggle');
const filtersToggle = byId<HTMLButtonElement>('filters-toggle');
const refreshBtn = byId<HTMLButtonElement>('refresh-stations');
const surpriseBtn = byId<HTMLButtonElement>('surprise');
const themeBtn = byId<HTMLButtonElement>('theme-toggle');
const exportBtn = byId<HTMLButtonElement>('export-data');
const userTransfer = createUserTransfer({ readLegacy: exportUserData, prepareLegacy: prepareUserDataImport, applyLegacy: applyImportedUserData });
const importBtn = byId<HTMLButtonElement>('import-data');
const importInput = byId<HTMLInputElement>('import-data-input');

const discovery = installDiscovery({
  allowDirectory: () => activePack.id === 'radio',
  prepareArea: () => {
    view = 'all';
    favoritesToggle?.classList.remove('header-btn--active');
    recentToggle?.classList.remove('header-btn--active');
    setFilterState({ countries: [] }, { emit: false });
  },
  normalize: (raw: unknown) => normalizeStation(raw, getBadStations()),
  context: () => ({ badStations: getBadStations() }),
  map: getMapInstance,
  current: getCurrentStation,
  visible: () => currentStations,
  refresh: () => { if (featureModulesReady) applyFilters(); },
  favorites: getFavorites,
  selected: () => activeStationUuid,
  notify: showToast,
  timeout: (station: Station) => handlePlaybackFailure(station, new Error('selection-timeout')),
  fail: (station: Station) => {
    stopNowPlaying(); pause({ preserveIntent: true }); updatePlayerBar(station);
    highlightCard(station.stationuuid); syncRoute(getActiveFilters());
    setStatus(translate('playback.couldNotConnect'));
  },
  play: (station: Station, options = {}) => { void onStationClick(station, options); }
});

// ---- Card rendering ----

function renderStationCard(station: Station): HTMLElement {
  // Not an interactive element itself (avoids nesting interactive controls); the play and
  // favorite buttons are the keyboard-accessible controls. Card click is a mouse convenience.
  const card = createEl('article', 'station-card');
  card.dataset.uuid = station.stationuuid;
  card.setAttribute('aria-label', station.name);
  if (station.stationuuid === activeStationUuid) card.classList.add('station-card--active');
  if (isUnreachable(station.stationuuid)) card.classList.add('station-card--unavailable');

  const media = createEl('div', 'station-card__media');
  media.append(station.favicon ? buildLogo(station) : buildMonogram(station.name));
  const flag = createEl('span', 'station-card__flag', countryCodeToFlag(station.countrycode));
  media.append(flag);

  const body = createEl('div', 'station-card__body');
  const name = createEl('span', 'station-card__name', station.name || 'Unknown Station');
  name.title = station.name || 'Unknown Station';
  const meta = createEl('div', 'station-card__meta');

  const pills = createEl('div', 'station-card__pills');

  const tags = createEl('div', 'station-card__tags');
  for (const tag of (station.tagList || []).slice(0, 3)) {
    tags.appendChild(createEl('span', 'tag-pill', tag));
  }

  meta.replaceChildren(createStationFacts(station), discovery.variantControl(station));
  body.append(name, meta, pills, tags);

  const play = createEl('button', 'station-card__play');
  play.type = 'button';
  play.append(icon('play'));
  play.setAttribute('aria-label', t('player.play') + ': ' + station.name);

  const favorite = createEl('button', 'station-card__favorite');
  favorite.type = 'button';
  favorite.append(icon('heart'));
  favorite.classList.toggle('station-card__favorite--active', discovery.isFavorite(station, getFavorites()));
  favorite.setAttribute('aria-label', (discovery.isFavorite(station, getFavorites()) ? 'Unfavorite station: ' : 'Favorite station: ') + station.name);
  favorite.setAttribute('aria-pressed', String(discovery.isFavorite(station, getFavorites())));

  card.append(media, body, play, favorite, discovery.explainButton(station));

  card.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('.station-card__favorite')) {
      event.stopPropagation();
      onFavoriteStation(station);
      return;
    }
    if (target.closest('.quality-pill,.er-stream-control')) return; // handled by its own listener
    void onStationClick(station);
  });

  return card;
}

function buildLogo(station: Station): HTMLElement {
  const img = new Image();
  img.className = 'station-card__logo';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.alt = '';
  img.addEventListener('error', () => img.replaceWith(buildMonogram(station.name)), { once: true });
  img.src = station.favicon;
  return img;
}

function buildMonogram(name: string): HTMLElement {
  const monogram = createEl('span', 'station-card__monogram');
  const letter = (name || '?').replace(/[^\p{L}\p{N}]/u, '').charAt(0).toUpperCase() || '?';
  monogram.textContent = letter;
  const hue = Number.parseInt(stableHash(name || 'x').slice(0, 6), 36) % 360;
  monogram.style.background = `hsl(${hue} 45% 88%)`;
  monogram.style.color = `hsl(${hue} 55% 28%)`;
  return monogram;
}

function buildMetaLine(station: Station): string {
  const sourceCount = station.sourceAgreement?.sourceCount;
  return [
    station.country,
    station.codec,
    station.bitrate ? `${station.bitrate} kbps` : '',
    station.secureStream ? 'HTTPS' : 'HTTP',
    sourceCount ? `${sourceCount} source${sourceCount === 1 ? '' : 's'}` : ''
  ]
    .filter(Boolean)
    .join(' · ');
}

const QUALITY_GLYPHS: Record<string, string> = { strong: '▲', ok: '●', weak: '◔', poor: '▽' };

function buildQualityPill(station: Station): HTMLElement {
  const label = station.quality?.label || 'weak';
  const score = station.quality?.score ?? 0;
  const pill = createEl('button', `quality-pill quality-pill--${label}`);
  pill.type = 'button';
  pill.setAttribute('aria-haspopup', 'dialog');
  pill.setAttribute('aria-label', `Quality ${score} ${label}, show details`);
  pill.append(createEl('span', 'quality-pill__glyph', QUALITY_GLYPHS[label] || '●'));
  pill.append(document.createTextNode(`${score} ${label}`));
  pill.addEventListener('click', event => {
    event.stopPropagation();
    showQualityPopover(pill, station);
  });
  return pill;
}

function buildSourcePill(station: Station): HTMLElement {
  const pill = createEl('span', 'source-pill');
  pill.textContent = (station.sourceAgreement?.sourceCount ?? 0) > 1 ? 'federated' : 'directory';
  pill.title = station.sourceSummary || 'Source claim unavailable';
  return pill;
}

// ---- Quality popover (accessible disclosure instead of a native title tooltip) ----

let popoverEl: HTMLElement | null = null;

function showQualityPopover(anchor: HTMLElement, station: Station): void {
  hideQualityPopover();
  const popover = createEl('div', 'quality-popover');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Quality explanation');

  popover.append(createEl('div', 'quality-popover__title', `Quality ${station.quality?.score ?? 0} (${station.quality?.label || 'weak'})`));
  const list = createEl('ul', 'quality-popover__list');
  for (const reason of station.quality?.reasons || ['No quality rationale available']) {
    list.appendChild(createEl('li', undefined, reason));
  }
  popover.append(list);
  if (station.sourceSummary) popover.append(createEl('div', 'quality-popover__sources', `Sources: ${station.sourceSummary}`));

  document.body.appendChild(popover);
  const rect = anchor.getBoundingClientRect();
  const top = Math.min(rect.bottom + 6, window.innerHeight - popover.offsetHeight - 8);
  const left = Math.min(rect.left, window.innerWidth - popover.offsetWidth - 8);
  popover.style.top = `${Math.max(8, top)}px`;
  popover.style.left = `${Math.max(8, left)}px`;
  popoverEl = popover;

  setTimeout(() => document.addEventListener('click', onPopoverOutside, { once: true }), 0);
}

function onPopoverOutside(event: MouseEvent): void {
  if (popoverEl && !popoverEl.contains(event.target as Node)) hideQualityPopover();
}

function hideQualityPopover(): void {
  popoverEl?.remove();
  popoverEl = null;
}

// ---- Grid + state ----

function ensureGrid(): VirtualGrid<Station> {
  if (!grid && gridEl) {
    grid = new VirtualGrid<Station>({
      viewport: gridEl,
      rowHeight: ROW_HEIGHT,
      minColumnWidth: MIN_COLUMN_WIDTH,
      gap: CARD_GAP,
      inset: 16,
      renderItem: station => renderStationCard(station)
    });
  }
  return grid!;
}

function renderGrid(stations: Station[]): void {
  if (!gridEl) return;
  if (!stations.length) {
    gridEl.style.display = 'none';
    renderEmptyState(view === 'recent' ? t('empty.noRecent') : t('empty.noMatch'), [
      { text: t('empty.clearFilters'), action: 'clear-filters' },
      { text: t('empty.refresh'), action: 'refresh-stations' }
    ]);
    updateGridCount(0);
    return;
  }
  gridEl.style.display = 'block';
  if (emptyStateEl) emptyStateEl.style.display = 'none';
  ensureGrid().setItems(stations);
  updateGridCount(stations.length);
}

function computeBaseList(): Station[] {
  if (view === 'recent') return recentStationsView(getRecentStations(100), allStations);
  if (view === 'similar') return similarTarget ? similarStations(similarTarget, allStations) : allStations;
  return allStations;
}

function applyFilters(): void {
  allStations = discovery.augment(allStations);
  const filters = getActiveFilters();
  const base = computeBaseList();
  currentStations = filterStations(base, {
    ...filters,
    favoritesOnly: view === 'favorites',
    favoriteUuids: discovery.favoriteIds(allStations, getFavorites())
  });

  currentStations = discovery.transform(currentStations, { all: allStations, view });
  renderGrid(currentStations);
  updateMapMarkers(currentStations);
  updateSearchStations(currentStations);
  updateGridTitle(filters);
  setStatus(t('status.visible', { visible: currentStations.length, total: allStations.length }));
  syncRoute(filters);
}

function syncRoute(filters: ReturnType<typeof getActiveFilters>): void {
  const state: RouteState = {
    view: view === 'all' ? undefined : view,
    countries: filters.countries,
    tags: filters.tags,
    bitrates: filters.bitrates,
    secure: filters.secureOnly || undefined,
    minQuality: filters.minQuality || undefined
  };
  if (activeStationUuid) state.station = activeStationUuid;
  writeRoute(state);
}

function updateGridTitle(filters: ReturnType<typeof getActiveFilters>): void {
  if (!gridTitleEl) return;
  const hasFilters = filters.countries.length || filters.tags.length || filters.bitrates.length || filters.secureOnly || filters.minQuality > 0;
  if (view === 'favorites') gridTitleEl.textContent = t('grid.favorites');
  else if (view === 'recent') gridTitleEl.textContent = t('grid.recent');
  else if (view === 'similar') gridTitleEl.textContent = t('grid.similar');
  else gridTitleEl.textContent = hasFilters ? t('grid.filtered') : t('grid.all');
}

async function onStationClick(station: Station, options: { retry?: boolean; recovery?: boolean; intent?: string; continuation?: boolean } = {}): Promise<void> {
  if (!station) return;
  const restart = Boolean(options.retry || discovery.isFailed());
  const ticket = discovery.begin(station, options);
  if (ticket === null) return;
  if (!options.recovery && !options.continuation) autoSkipCount = 0;
  highlightCard(station.stationuuid); syncRoute(getActiveFilters());
  setStatus(t('status.loadingStation', { name: station.name }));
  const ok = await playStation(station, { restart });
  if (ok && discovery.isCurrent(ticket) && discovery.playing(station)) {
    clearStationPlaybackFailure(station.stationuuid);
    setLastPlayed(station);
    updatePlayerBar(station);
    highlightCard(station.stationuuid);
    dispatchStationSelected(station);
    presentNowPlaying(station);
    setStatus(t('status.playing', { name: station.name }));
    syncRoute(getActiveFilters());
  }
}

function dispatchStationSelected(station: Station): void {
  // Overlays need the selected source only after playStation() has actually started
  // playback, including previous/next and Media Session navigation paths.
  window.dispatchEvent(new CustomEvent('earthradio:station-selected', {
    detail: {
      streamUrl: String(station.url_resolved || station.url || ''),
      stationUuid: String(station.stationuuid || '')
    }
  }));
}

// Drop the map beacon, fly to the station, open the now-playing sidecar, start ICY metadata,
// and load country facts — the whole "where + what is playing" experience for a station.
function presentNowPlaying(station: Station): void {
  setPlayingStation(station);
  showNowPlayingStation(station);
  beginNowPlaying(station);
  void loadCountryFacts(station);
}

async function loadCountryFacts(station: Station): Promise<void> {
  const facts = await getCountryFacts(station.countrycode);
  if (getCurrentStation()?.stationuuid === station.stationuuid) setNowPlayingCountryFacts(facts);
}

function beginNowPlaying(station: Station): void {
  if (!config.nowPlayingEnabled) return;
  startNowPlaying(station, {
    onTitle: title => {
      if (getCurrentStation()?.stationuuid !== station.stationuuid) return;
      setNowPlayingMetadata(title);
      updatePlayerFacts(station, { rawTitle: title });
      const track = parseNowPlaying(title);
      if (!track) return;
      setNowPlayingTrack(track, { found: false, artist: track.artist, title: track.title });
      void identifyTrack(track).then(enrichment => {
        if (getCurrentStation()?.stationuuid === station.stationuuid) setNowPlayingTrack(track, enrichment);
      });
    }
  });
}

function onFavoriteStation(station: Station): void {
  const isFav = !discovery.isFavorite(station, getFavorites());
  for (const member of discovery.favoriteTargets(station, getFavorites())) toggleFavorite(member.stationuuid, member);
  updateFavoriteBtnState();
  updateFavoritesCount();
  showToast(isFav ? t('toast.added') : t('toast.removed'));
  if (view === 'favorites') applyFilters();
  else grid?.refresh();
}

function updatePlayerBar(station: Station | null): void {
  if (!station) return;
  if (playerStationEl) playerStationEl.textContent = station.name || 'Unknown Station';
  updatePlayerFacts(station);
  updateFavoriteBtnState();
  updatePlayBtnState();
}

function updatePlayBtnState(): void {
  if (!btnPlay) return;
  byId('player-bar')!.dataset.playbackState = getPlaybackStatus();
  const status = getPlaybackStatus();
  const playing = status === 'playing' || status === 'loading';
  btnPlay.replaceChildren(icon(playing ? 'pause' : 'play'));
  btnPlay.setAttribute('aria-label', isPlayingNow() ? t('player.pause') : t('player.play'));
  byId('player-bar')?.classList.toggle('is-playing', status === 'playing');
}

function updateFavoriteBtnState(): void {
  if (!btnFavorite) return;
  const station = getCurrentStation();
  const fav = Boolean(station && isFavorite(station.stationuuid));
  btnFavorite.classList.toggle('player-btn--active', fav);
  btnFavorite.setAttribute('aria-pressed', String(fav));
}

function updateFavoritesCount(): void {
  const countEl = document.querySelector('.favorites-count');
  if (countEl) countEl.textContent = String(getFavorites().size);
}

function highlightCard(uuid: string): void {
  activeStationUuid = uuid;
  grid?.refresh();
}

function updateGridCount(count: number): void {
  if (gridCountEl) gridCountEl.textContent = count === 1 ? t('grid.countOne') : t('grid.count', { count });
}

function setStatus(message: string): void {
  if (statusLineEl) statusLineEl.textContent = message;
}

function showLoadingState(): void {
  if (!gridEl) return;
  gridEl.style.display = 'none';
  renderEmptyState(t('empty.loading'), [], true);
  updateGridCount(0);
  setStatus(t('status.loading'));
}

interface EmptyAction {
  text: string;
  action: string;
}

function renderEmptyState(message: string, actions: EmptyAction[] = [], spinner = false): void {
  if (!emptyStateEl) return;
  emptyStateEl.style.display = 'flex';
  emptyStateEl.innerHTML = '';
  if (spinner) emptyStateEl.appendChild(createEl('div', 'loading-spinner'));
  emptyStateEl.appendChild(createEl('p', undefined, message));
  for (const action of actions) {
    const button = createEl('button', 'btn-clear', action.text);
    button.type = 'button';
    button.dataset.action = action.action;
    emptyStateEl.appendChild(button);
  }
}

interface StationLoadOutcome {
  ok: boolean;
  loadId: number;
}

const stationLoadState: {
  promise: Promise<StationLoadOutcome> | null;
  queued: boolean;
  forceRefresh: boolean;
  nextLoadId: number;
} = {
  promise: null,
  queued: false,
  forceRefresh: false,
  nextLoadId: 0
};

async function loadStations({ forceRefresh = false } = {}): Promise<StationLoadOutcome> {
  stationLoadState.queued = true;
  stationLoadState.forceRefresh ||= forceRefresh;
  if (stationLoadState.promise) return stationLoadState.promise;

  const drain = async (): Promise<StationLoadOutcome> => {
    let outcome: StationLoadOutcome = { ok: false, loadId: stationLoadState.nextLoadId };
    while (stationLoadState.queued) {
      stationLoadState.queued = false;
      const nextForceRefresh = stationLoadState.forceRefresh;
      stationLoadState.forceRefresh = false;
      const loadId = ++stationLoadState.nextLoadId;
      outcome = await performStationLoad({ forceRefresh: nextForceRefresh, loadId });
    }
    return outcome;
  };
  const promise = drain().finally(() => {
    if (stationLoadState.promise !== promise) return;
    stationLoadState.promise = null;
    // A caller can enqueue in the microtask gap between drain's last loop check and
    // this finalizer. Adopt the restarted drain so every caller still owns a promise
    // that settles only after its queued refresh has physically completed.
    if (stationLoadState.queued) return loadStations();
  });
  stationLoadState.promise = promise;
  return promise;
}

async function performStationLoad({ forceRefresh, loadId }: { forceRefresh: boolean; loadId: number }): Promise<StationLoadOutcome> {
  showLoadingState();
  let ok = true;
  try {
    const result = await activePack.loadEntities({ forceRefresh });
    const routeBeforeControls = readRoute();
    allStations = result.stations;
    if (routeBeforeControls.station && allStations.some(station => station.stationuuid === routeBeforeControls.station)) activeStationUuid = routeBeforeControls.station;

    if (!featureModulesReady) {
      const prefs = getPreferences();
      const route = readRoute();
      initMap('map', allStations, {
        onStationClick: station => void onStationClick(station),
        onCountrySelect: country => applyCountry(country),
        markerStyle: station => activePack.markerStyle(station)
      });
      initSearch(allStations, station => void onStationClick(station));
      initFilters(allStations, applyFilters, {
        secureOnly: route.secure ?? prefs.secureOnly,
        minQuality: route.minQuality ?? prefs.minQuality,
        countries: route.countries,
        tags: route.tags,
        bitrates: route.bitrates
      });
      if (route.view === 'favorites' || route.view === 'recent') view = route.view;
      featureModulesReady = true;
    } else {
      updateMapMarkers(allStations);
      updateSearchStations(allStations);
    }

    applyFilters();

    const route = readRoute();
    const target = route.station ? allStations.find(station => station.stationuuid === route.station) : null;
    const lastPlayed = getLastPlayed();
    if (target) {
      activeStationUuid = target.stationuuid;
      updatePlayerBar(target);
    } else if (lastPlayed) {
      updatePlayerBar(lastPlayed);
    }

    const mode = result.cached ? (result.stale ? 'stale cache' : 'cache') : 'live';
    const sourceLabel = result.sourceSummary?.label || result.source || 'unknown source';
    setStatus(directorySnapshotStatus(result, currentStations.length) || t('status.loaded', { count: currentStations.length, mode, source: sourceLabel }));
      if (result.stale) showToast(t('discovery.savedCopy'));
    void runHealthProbe(currentStations, { onUpdate: () => grid?.refresh() });
  } catch (error) {
    console.error('Failed to load stations:', error);
    setStatus(`${t('toast.loadFailed')}: ${(error as Error).message}`);
    renderEmptyState(t('empty.failed'), [{ text: t('empty.retry'), action: 'refresh-stations' }]);
    showToast(t('toast.loadFailed'), 'error');
    ok = false;
  } finally {
    // Directory-expansion serializes forced refreshes on this settle signal instead of
    // guessing with a timer; it fires on success and failure alike.
    window.dispatchEvent(new CustomEvent('earthradio:stations-load-settled', { detail: { ok, loadId } }));
  }
  return { ok, loadId };
}

const runtimeWindow = window as typeof window & {
  earthRadioRuntime?: { refreshStations?: () => Promise<StationLoadOutcome> };
};
runtimeWindow.earthRadioRuntime = Object.freeze({
  ...(runtimeWindow.earthRadioRuntime || {}),
  refreshStations: () => loadStations({ forceRefresh: true })
});

function applyCountry(country: string): void {
  view = 'all';
  setFilterState(countrySelection(country));
}

// ---- Event wiring ----

function setupPlayerEvents(): void {
  btnPlay?.addEventListener('click', async () => {
    if (isPlayingNow()) { pause(); updatePlayBtnState(); return; }
    const last = getLastPlayed();
    const selected = discovery.selectedStation(getCurrentStation()) || getCurrentStation()
      || allStations.find(station => station.stationuuid === activeStationUuid)
      || allStations.find(station => station.stationuuid === last?.stationuuid) || last;
    if (selected) await onStationClick(selected);
    updatePlayBtnState();
  });

  btnPrev?.addEventListener('click', async () => {
    const selected = getRelativeStation(currentStations, -1);
    if (selected) await onStationClick(selected);
  });

  btnNext?.addEventListener('click', async () => {
    const selected = getRelativeStation(currentStations, 1);
    if (selected) await onStationClick(selected);
  });

  btnSimilar?.addEventListener('click', () => {
    const station = getCurrentStation();
    if (!station) {
      showToast(t('toast.noStations'));
      return;
    }
    similarTarget = station;
    view = 'similar';
    applyFilters();
  });

  if (volumeSlider) {
    const prefs = getPreferences();
    volumeSlider.value = String(prefs.volume ?? 0.8);
    setVolume(volumeSlider.value);
    volumeSlider.addEventListener('input', event => {
      const value = (event.target as HTMLInputElement).value;
      setVolume(value);
      setPreference('volume', Number(value));
    });
  }

  btnFavorite?.addEventListener('click', () => {
    const station = getCurrentStation();
    if (station) onFavoriteStation(station);
  });

  setupSleepTimer();
}

function setupSleepTimer(): void {
  if (!btnSleep || !sleepMenu) return;

  btnSleep.addEventListener('click', event => {
    event.stopPropagation();
    sleepMenu.classList.toggle('sleep-menu--open');
  });

  document.addEventListener('click', event => {
    if (!(event.target as HTMLElement).closest('.sleep-dropdown')) sleepMenu.classList.remove('sleep-menu--open');
  });

  sleepMenu.querySelectorAll<HTMLButtonElement>('button[data-min]').forEach(button => {
    button.addEventListener('click', () => {
      const minutes = Number.parseInt(button.dataset.min || '0', 10) || 0;
      if (sleepTimerId) clearTimeout(sleepTimerId);
      sleepTimerId = null;
      if (minutes > 0) {
        sleepTimerId = setTimeout(() => {
          pause();
          updatePlayBtnState();
          setStatus(t('toast.sleepSet', { minutes }));
          sleepTimerId = null;
        }, minutes * 60_000);
        showToast(t('toast.sleepSet', { minutes }));
      } else {
        showToast(t('toast.sleepOff'));
      }
      sleepMenu.classList.remove('sleep-menu--open');
    });
  });
}

function setupHeaderEvents(): void {
  favoritesToggle?.addEventListener('click', () => {
    view = view === 'favorites' ? 'all' : 'favorites';
    favoritesToggle.classList.toggle('header-btn--active', view === 'favorites');
    recentToggle?.classList.remove('header-btn--active');
    applyFilters();
  });

  recentToggle?.addEventListener('click', () => {
    view = view === 'recent' ? 'all' : 'recent';
    recentToggle.classList.toggle('header-btn--active', view === 'recent');
    favoritesToggle?.classList.remove('header-btn--active');
    applyFilters();
  });

  filtersToggle?.addEventListener('click', event => {
    event.stopPropagation();
    openFilters();
  });

  refreshBtn?.addEventListener('click', () => void loadStations({ forceRefresh: true }));

  surpriseBtn?.addEventListener('click', () => {
    const pool = currentStations.length ? currentStations : allStations;
    const pick = surpriseStation(pool);
    if (pick) {
      showToast(t('toast.surprise', { name: pick.name }));
      void onStationClick(pick, { intent: 'world-scan' });
    } else {
      showToast(t('toast.noStations'));
    }
  });

  themeBtn?.addEventListener('click', () => {
    const next = cycleTheme();
    themeBtn.setAttribute('aria-label', `${t('header.theme')} (${next})`);
    setMapTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  });

  exportBtn?.addEventListener('click', async () => {
    try {
      const owner = userTransfer.captureOwner(), data = await userTransfer.exportData();
      userTransfer.assertOwner(owner);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `earth-radio-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (data.passportOmitted) showToast(translate('transfer.partialExport'), 'error');
    } catch (error) {
      if ((error as any)?.code !== 'ACCOUNT_CHANGED') showToast(translate('transfer.exportFailed'), 'error');
    }
  });

  importBtn?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('click', event => {
    userTransfer.cancelImport(importTicket); importTicket = null;
    try { importTicket = userTransfer.beginImport(); }
    catch (error) { event.preventDefault(); showToast(translate((error as any)?.code === 'PASSPORT_POLICY_CHANGED' ? 'passport.historyChanged' : 'transfer.importFailed'), 'error'); }
  });
  importInput?.addEventListener('cancel', () => { userTransfer.cancelImport(importTicket); importTicket = null; });
  importInput?.addEventListener('change', event => {
    const ticket = importTicket; importTicket = null;
    void handleImportFile((event.target as HTMLInputElement).files?.[0], ticket);
  });

  emptyStateEl?.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action');
    if (action === 'clear-filters') {
      discovery.clear();
      view = 'all';
      favoritesToggle?.classList.remove('header-btn--active');
      recentToggle?.classList.remove('header-btn--active');
      resetFilters();
    }
    if (action === 'refresh-stations') void loadStations({ forceRefresh: true });
  });
}

let importTicket: object | null = null;
async function handleImportFile(file: File | undefined, ticket: object | null): Promise<void> {
  if (!file) return;
  try {
    const owner = userTransfer.captureOwner(), result = await userTransfer.importFile(file, { ticket });
    userTransfer.assertOwner(owner);
    applyUserPreferencesToControls();
    updateFavoritesCount();
    updateFavoriteBtnState();
    grid?.refresh();
    if (view === 'favorites') applyFilters();
    const report = result.legacy;
    const message = result.partial ? translate('transfer.partial') : report
      ? translate('transfer.imported', { favorites: report.favoritesImported, recent: report.recentImported, prefs: report.preferencesImported })
      : translate('transfer.passportImported');
    showToast(message, result.partial ? 'error' : undefined); setStatus(message);
  } catch (error) {
    if ((error as any)?.code !== 'ACCOUNT_CHANGED') showToast(translate((error as any)?.code === 'PASSPORT_POLICY_CHANGED' ? 'passport.historyChanged' : 'transfer.importFailed'), 'error');
  } finally {
    userTransfer.cancelImport(ticket);
    if (importInput) importInput.value = '';
  }
}

function applyUserPreferencesToControls(): void {
  const prefs = getPreferences();
  if (volumeSlider) {
    volumeSlider.value = String(prefs.volume ?? 0.8);
    setVolume(volumeSlider.value);
  }
  setFilterState({ secureOnly: prefs.secureOnly, minQuality: prefs.minQuality }, { emit: true });
}

function setupIcons(): void {
  btnPrev?.replaceChildren(icon('prev'));
  btnNext?.replaceChildren(icon('next'));
  btnPlay?.replaceChildren(icon('play'));
  btnFavorite?.replaceChildren(icon('heart'));
  btnSimilar?.replaceChildren(icon('similar'));
  btnSleep?.replaceChildren(icon('moon'));
  themeBtn?.replaceChildren(icon('theme'));
  byId('settings-toggle')?.replaceChildren(icon('settings'));
  document.querySelector('.heart-icon')?.replaceChildren(icon('heart'));
}

function setupCollections(): void {
  if (!collectionsEl) return;
  collectionsEl.innerHTML = '';
  for (const collection of CURATED_COLLECTIONS) {
    const chip = createEl('button', 'collection-chip', collection.label);
    chip.type = 'button';
    chip.dataset.collection = collection.id;
    chip.addEventListener('click', () => {
      view = 'all';
      favoritesToggle?.classList.remove('header-btn--active');
      recentToggle?.classList.remove('header-btn--active');
      setFilterState(collectionFilter(collection));
      collectionsEl?.querySelectorAll<HTMLElement>('.collection-chip').forEach(node => {
        node.classList.toggle('collection-chip--active', node.dataset.collection === collection.id);
      });
    });
    collectionsEl.appendChild(chip);
  }
}

function setupKeyboard(): void {
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
      return;
    }
    if (event.key === 'Escape') {
      hideQualityPopover();
      closeSearch();
      closeFilters();
      closeSettings();
    }
  });
}

/**
 * Choose the next station to try after a failure: prefer one similar to the failed station
 * (shared tags/country/codec), skipping stations already known to fail; fall back to the
 * next playable station in the current list.
 */
function pickNextStation(failed: Station): Station | null {
  const bad = new Set<string>([...getBadStations().keys(), ...getUnreachable()]);
  return nextStationAfterFailure(failed, currentStations, bad);
}

function setupAudioErrorHandling(): void {
  initPlayer({
    onStateChange: (state, station) => { updatePlayBtnState(); if (state === 'playing' && discovery.playing(station)) autoSkipCount = 0; },
    onStationChange: updatePlayerBar,
    onPlaying: station => { if (discovery.playing(station)) void activePack.recordSelection(station); },
    onPause: () => discovery.cancel(),
    onPlay: () => void btnPlay?.click(),
    onPrev: () => void btnPrev?.click(),
    onNext: () => void btnNext?.click(),
    onCanPlay: station => {
      discovery.observe(station, true);
      if (!station) return;
      clearStationPlaybackFailure(station.stationuuid);
      if (!config.streamProbeEnabled) return;
      void probeStationStream(station).then(observation => {
        if (!observation?.ok || getCurrentStation()?.stationuuid !== station.stationuuid) return;
        updatePlayerFacts(station, { probeTitle: observation.metadata?.streamTitle });
      });
    },
    onError: handlePlaybackFailure,
    onEnded: updatePlayBtnState,
    onVolumeChange: volume => setPreference('volume', volume)
  });
}

function handlePlaybackFailure(station: Station | null, error: Error): void {
  if (!discovery.acceptsError(station)) return;
  discovery.observe(station, false);
  if (station) markStationPlaybackFailure(station.stationuuid, error?.message || 'playback-error');
  stopNowPlaying();
  if (discovery.recover(station)) return;
  if (!discovery.canAutoSkip() || !config.autoSkipOnPlaybackError || autoSkipCount >= MAX_AUTO_SKIPS) { discovery.fail(station); return; }
  autoSkipCount += 1;
  const next = station ? pickNextStation(station) : currentStations[0];
  if (!next) { discovery.fail(station); return; }
  showToast(translate('playback.scanning', { name: next.name }));
  setStatus(t('status.skipping', { name: next.name }));
  void onStationClick(next, { intent: 'world-scan', continuation: true });
}

function setupRouting(): void {
  onRouteChange(state => {
    if (state.view === 'favorites' || state.view === 'recent' || state.view === 'similar') view = state.view;
    else view = 'all';
    favoritesToggle?.classList.toggle('header-btn--active', view === 'favorites');
    recentToggle?.classList.toggle('header-btn--active', view === 'recent');
    setFilterState(
      {
        countries: state.countries ?? [],
        tags: state.tags ?? [],
        bitrates: state.bitrates ?? [],
        secureOnly: state.secure ?? false,
        minQuality: state.minQuality ?? 0
      },
      { emit: true }
    );
  });
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const register = (): void => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* app works without the service worker */
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

async function startup(): Promise<void> {
  document.documentElement.dataset.appVersion = APP_VERSION;
  await hydrateStorage();

  const prefs = getPreferences();
  setLocale(prefs.locale || 'en');
  applyDocumentLocale();
  initTheme();

  const domainParam = new URLSearchParams(location.search).get('domain');
  if (domainParam) activePack = setActiveDomain(domainParam) ?? activePack;
  if (gridSubtitleEl) gridSubtitleEl.textContent = activePack.subtitle;

  updateFavoritesCount();
  setupIcons();
  setupCollections();
  initSettings();
  initNowPlayingPanel({ onExploreCountry: applyCountry });
  setupPlayerEvents();
  setupHeaderEvents();
  setupKeyboard();
  setupAudioErrorHandling();
  setupRouting();
  registerServiceWorker();
  await loadStations();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void startup());
else void startup();
