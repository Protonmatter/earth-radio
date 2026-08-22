import {
  applyDeclarativeI18n,
  applyDocumentLocale,
  detectBrowserLocale,
  normalizeLocale,
  t
} from '../i18n/index.js';

export const UI_STORAGE_KEY = 'earthRadio.ui.v1';
export const DEFAULT_SPLIT = 42;
export const MIN_LIST_PX = 340;
export const MIN_MAP_PX = 360;
export const MOBILE_MAX = 767;
export const TABLET_MAX = 1099;
export const DESTINATIONS = Object.freeze(['listen', 'search', 'map', 'saved']);

export function parseDestination(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  if (raw.includes('=')) return null;
  const token = raw.split(/[/?&]/, 1)[0].toLowerCase();
  return DESTINATIONS.includes(token) ? token : 'listen';
}

export function clampSplitPercent(percent, viewportWidth, minList = MIN_LIST_PX, minMap = MIN_MAP_PX) {
  const width = Number(viewportWidth);
  const raw = Number(percent);
  if (!Number.isFinite(width) || width < minList + minMap) return DEFAULT_SPLIT;
  const minPct = (minList / width) * 100;
  const maxPct = 100 - (minMap / width) * 100;
  if (!Number.isFinite(raw)) return DEFAULT_SPLIT;
  return Math.round(Math.min(maxPct, Math.max(minPct, raw)) * 10) / 10;
}

export function nextCollapse(current, target) {
  if (target !== 'map' && target !== 'list') return current ?? null;
  if (current === target) return null;
  return target;
}

export function parseNowPlayingHistory(state) {
  return Boolean(state && state.erNowPlaying === true);
}

export function sanitizeUiState(raw, viewportWidth = 1440) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    version: 1,
    destination: DESTINATIONS.includes(src.destination) ? src.destination : 'listen',
    savedSegment: src.savedSegment === 'recent' ? 'recent' : 'favorites',
    collapsed: src.collapsed === 'map' || src.collapsed === 'list' ? src.collapsed : null,
    split: clampSplitPercent(src.split, Number(src.viewportWidth) || viewportWidth),
    locale: normalizeLocale(src.locale)
  };
}

export function loadUiState() {
  try {
    return sanitizeUiState(JSON.parse(globalThis.localStorage?.getItem(UI_STORAGE_KEY) || 'null'));
  } catch {
    return sanitizeUiState(null);
  }
}

export function saveUiState(partial) {
  const next = sanitizeUiState({ ...loadUiState(), ...partial, viewportWidth: globalThis.innerWidth || 1440 });
  try {
    globalThis.localStorage?.setItem(UI_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* session-only */
  }
  return next;
}

function byId(id) {
  return document.getElementById(id);
}

function classifyViewport(width = window.innerWidth) {
  if (width <= MOBILE_MAX) return 'mobile';
  if (width <= TABLET_MAX) return 'tablet';
  return 'desktop';
}

function isStandalone() {
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator?.standalone
  );
}

function clickExisting(id) {
  byId(id)?.click();
}

function invalidateMap() {
  window.dispatchEvent(new Event('resize'));
}

function readLocale(state) {
  const stored = state.locale && state.locale !== 'en' ? state.locale : '';
  if (stored) return stored;
  const select = byId('setting-locale');
  if (select?.value) return normalizeLocale(select.value);
  return detectBrowserLocale([navigator.language, ...(navigator.languages || [])]);
}

function applyLocale(state) {
  const locale = readLocale(state);
  applyDocumentLocale(locale);
  applyDeclarativeI18n(document, locale);
  const select = byId('setting-locale');
  if (select && [...select.options].some(option => option.value === locale)) select.value = locale;
  return saveUiState({ locale });
}

function applyViewport(state) {
  const mode = classifyViewport();
  document.documentElement.classList.toggle('er-mobile', mode === 'mobile');
  document.documentElement.classList.toggle('er-tablet', mode === 'tablet');
  document.documentElement.classList.toggle('er-desktop', mode === 'desktop');
  document.documentElement.classList.toggle('er-standalone', isStandalone());
  document.documentElement.dataset.erDest = state.destination;
  document.documentElement.dataset.erSaved = state.savedSegment;
  document.documentElement.dataset.erCollapsed = state.collapsed || '';
  document.documentElement.style.setProperty('--er-list-pct', `${state.split}%`);
  for (const button of document.querySelectorAll('[data-er-dest]')) {
    const active = button.getAttribute('data-er-dest') === state.destination;
    button.setAttribute('aria-current', active ? 'page' : 'false');
    button.classList.toggle('is-active', active);
  }
  for (const button of document.querySelectorAll('[data-er-saved]')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-er-saved') === state.savedSegment));
  }
  applyWorkspace(state, mode);
}

function applyWorkspace(state, mode) {
  const list = byId('grid-panel');
  const map = byId('map-panel');
  const search = byId('search-modal');
  if (!list || !map) return;

  if (mode === 'mobile') {
    list.hidden = state.destination === 'map' || state.destination === 'search';
    map.hidden = state.destination !== 'map';
    presentSearch(state.destination === 'search');
    return;
  }

  presentSearch(false);
  if (mode === 'tablet') {
    const showMap = state.destination === 'map' || state.collapsed === 'list';
    list.hidden = showMap;
    map.hidden = !showMap;
    return;
  }

  list.hidden = state.collapsed === 'list';
  map.hidden = state.collapsed === 'map';
  const separator = byId('er-separator');
  if (separator) separator.hidden = Boolean(state.collapsed);
  const restore = byId('er-restore-panel');
  if (restore) {
    restore.hidden = !state.collapsed || mode === 'mobile';
    restore.setAttribute('data-er-collapse', state.collapsed || 'map');
    restore.textContent = state.collapsed === 'list' ? t('desktop.restoreStations') : t('desktop.restoreMap');
  }
}

function presentSearch(active) {
  const modal = byId('search-modal');
  if (!modal) return;
  modal.classList.toggle('er-search-destination', active);
  if (active) {
    modal.hidden = false;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modal.setAttribute('aria-modal', 'false');
  } else if (modal.classList.contains('er-search-destination') || classifyViewport() === 'mobile') {
    modal.classList.remove('er-search-destination');
    if (classifyViewport() === 'mobile') {
      modal.hidden = true;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
  }
}

function setDestination(destination, persistHash = false) {
  const next = saveUiState({ destination });
  if (destination === 'saved') applySavedSegment(next.savedSegment);
  if (destination === 'listen') {
    const recent = byId('recent-toggle');
    const favorites = byId('favorites-toggle');
    if (recent?.classList.contains('header-btn--active')) recent.click();
    if (favorites?.classList.contains('header-btn--active')) favorites.click();
  }
  applyViewport(next);
  if (persistHash) {
    const current = location.hash.replace(/^#/, '');
    if (!current.includes('=')) history.replaceState(history.state, '', `#${destination}`);
  }
  queueMicrotask(invalidateMap);
  return next;
}

function applySavedSegment(segment) {
  const wanted = segment === 'recent' ? 'recent' : 'favorites';
  const recent = byId('recent-toggle');
  const favorites = byId('favorites-toggle');
  const recentOn = recent?.classList.contains('header-btn--active') || recent?.getAttribute('aria-pressed') === 'true';
  const favOn = favorites?.classList.contains('header-btn--active') || favorites?.getAttribute('aria-pressed') === 'true';
  if (wanted === 'recent' && !recentOn) recent?.click();
  if (wanted === 'favorites' && !favOn) favorites?.click();
  saveUiState({ savedSegment: wanted, destination: 'saved' });
}

function openNowPlaying(push = true) {
  const panel = byId('er-nowplaying');
  if (!panel || !panel.hidden && panel.classList.contains('is-open')) return;
  syncNowPlaying();
  panel.hidden = false;
  panel.classList.add('is-open');
  document.documentElement.classList.add('er-nowplaying-open');
  if (push) history.pushState({ ...(history.state || {}), erNowPlaying: true }, '');
  byId('er-nowplaying-dismiss')?.focus();
}

function closeNowPlaying() {
  const panel = byId('er-nowplaying');
  if (!panel) return;
  panel.hidden = true;
  panel.classList.remove('is-open');
  document.documentElement.classList.remove('er-nowplaying-open');
  byId('player-bar')?.querySelector('#er-open-nowplaying, .player-info')?.focus?.();
}

function syncNowPlaying() {
  const title = byId('er-nowplaying-title');
  const meta = byId('er-nowplaying-meta');
  const live = byId('er-nowplaying-live');
  const art = byId('er-nowplaying-art');
  if (title) title.textContent = byId('player-station')?.textContent || t('player.select');
  if (meta) meta.textContent = byId('player-meta')?.textContent || '';
  if (live) live.textContent = t('nowplaying.live');
  const sourceArt = byId('nowcard-art');
  if (art && sourceArt) art.replaceChildren(...[...sourceArt.cloneNode(true).childNodes]);
}

function bindSearchIme() {
  const original = byId('search-input');
  if (!original || original.dataset.erIme === '1') return;
  original.dataset.erIme = '1';
  let composing = false;
  original.addEventListener('compositionstart', () => {
    composing = true;
  });
  original.addEventListener('compositionend', () => {
    composing = false;
    original.dispatchEvent(new Event('input', { bubbles: true }));
  });
  original.addEventListener('input', event => {
    if (composing) event.stopImmediatePropagation();
  }, true);
}

function bindLocaleOptions() {
  const select = byId('setting-locale');
  if (!select) return;
  const wanted = [
    ['en', t('settings.localeEn')],
    ['es', t('settings.localeEs')],
    ['ar', t('settings.localeAr')],
    ['ko', t('settings.localeKo')],
    ['zh-Hans', t('settings.localeZhHans')],
    ['zh-Hant', t('settings.localeZhHant')]
  ];
  const existing = new Set([...select.options].map(option => option.value));
  for (const [value, label] of wanted) {
    if (existing.has(value)) continue;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

function bindActions() {
  document.addEventListener('click', event => {
    const dest = event.target.closest('[data-er-dest]');
    if (dest) {
      event.preventDefault();
      setDestination(dest.getAttribute('data-er-dest'), true);
      return;
    }
    const saved = event.target.closest('[data-er-saved]');
    if (saved) {
      event.preventDefault();
      const segment = saved.getAttribute('data-er-saved');
      saveUiState({ destination: 'saved', savedSegment: segment });
      applySavedSegment(segment);
      applyViewport(loadUiState());
      return;
    }
    if (event.target.closest('[data-er-open-search]')) {
      if (classifyViewport() === 'mobile') setDestination('search', true);
      else {
        const eventK = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true });
        document.dispatchEvent(eventK);
        clickExisting('search-input');
        byId('search-input')?.focus();
      }
      return;
    }
    if (event.target.closest('[data-er-overflow]')) {
      const sheet = byId('er-overflow');
      if (sheet) {
        sheet.hidden = !sheet.hidden;
        sheet.setAttribute('aria-hidden', String(sheet.hidden));
      }
      return;
    }
    if (event.target.closest('[data-click-id]')) {
      clickExisting(event.target.closest('[data-click-id]').getAttribute('data-click-id'));
      byId('er-overflow').hidden = true;
      return;
    }
    if (event.target.closest('[data-er-collapse]')) {
      const target = event.target.closest('[data-er-collapse]').getAttribute('data-er-collapse');
      const state = loadUiState();
      applyViewport(saveUiState({ collapsed: nextCollapse(state.collapsed, target) }));
      queueMicrotask(invalidateMap);
      return;
    }
    if (event.target.closest('#er-open-nowplaying') || event.target.closest('#player-station')) {
      if (classifyViewport() === 'mobile' || classifyViewport() === 'tablet') openNowPlaying();
      else openNowPlaying();
      return;
    }
    if (event.target.closest('#er-nowplaying-dismiss')) {
      if (parseNowPlayingHistory(history.state)) history.back();
      else closeNowPlaying();
    }
  });

  byId('settings-save')?.addEventListener('click', () => {
    const locale = normalizeLocale(byId('setting-locale')?.value);
    saveUiState({ locale });
  }, true);

  window.addEventListener('popstate', event => {
    if (!parseNowPlayingHistory(event.state) && document.documentElement.classList.contains('er-nowplaying-open')) {
      closeNowPlaying();
    }
  });

  window.addEventListener('resize', () => {
    const state = sanitizeUiState({ ...loadUiState(), split: loadUiState().split, viewportWidth: window.innerWidth });
    saveUiState(state);
    applyViewport(state);
  });
}

function bindSeparator() {
  const separator = byId('er-separator');
  if (!separator) return;
  const applyValue = value => {
    const split = clampSplitPercent(value, window.innerWidth);
    separator.setAttribute('aria-valuenow', String(Math.round(split)));
    applyViewport(saveUiState({ split }));
    invalidateMap();
  };
  separator.addEventListener('keydown', event => {
    const current = loadUiState().split;
    const step = event.shiftKey ? 8 : 2;
    if (event.key === 'ArrowLeft') applyValue(current - step);
    if (event.key === 'ArrowRight') applyValue(current + step);
    if (event.key === 'Home') applyValue(0);
    if (event.key === 'End') applyValue(100);
    if (event.key === 'Enter' && event.detail === 0 && event.repeat === false && event.altKey) applyValue(DEFAULT_SPLIT);
  });
  separator.addEventListener('dblclick', () => applyValue(DEFAULT_SPLIT));
  let dragging = false;
  separator.addEventListener('pointerdown', event => {
    dragging = true;
    separator.setPointerCapture(event.pointerId);
  });
  separator.addEventListener('pointermove', event => {
    if (!dragging) return;
    const main = document.querySelector('main.main');
    if (!main) return;
    const rect = main.getBoundingClientRect();
    applyValue(((event.clientX - rect.left) / rect.width) * 100);
  });
  separator.addEventListener('pointerup', () => {
    dragging = false;
    invalidateMap();
  });
}

function observeRuntime() {
  const watched = ['player-station', 'player-meta', 'nowcard-art'];
  applyDeclarativeI18n(document, loadUiState().locale);
  const observer = new MutationObserver(() => {
    if (document.documentElement.classList.contains('er-nowplaying-open')) syncNowPlaying();
  });
  for (const id of watched) {
    const node = byId(id);
    if (node) observer.observe(node, { childList: true, characterData: true, subtree: true });
  }
}

function start() {
  document.documentElement.classList.add('er-root');
  bindLocaleOptions();
  bindSearchIme();
  const hashDest = parseDestination(location.hash);
  const loaded = loadUiState();
  const state = saveUiState({
    ...loaded,
    destination: hashDest || loaded.destination,
    locale: readLocale(loaded)
  });
  applyLocale(state);
  applyViewport(state);
  bindActions();
  bindSeparator();
  observeRuntime();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
