/*
 * Earth Radio responsive presentation layer.
 *
 * Additive only. This module never creates a second audio element, catalog,
 * favorites store, filter engine, metadata engine, or Leaflet map. It owns
 * presentation state (destination, Now Playing visibility, desktop split,
 * collapsed panel, Saved segment, focus-return targets, viewport class) and
 * routes every new control to an existing runtime control.
 *
 * It loads after the recovered runtime bundle, whose i18n catalog only covers
 * `en`, `es`, and `ar` and which collapses locale tags to their base subtag.
 * Korean and both Chinese variants are therefore localized here, from the
 * maintained catalogs, over a bounded list of known runtime-owned elements.
 */

import {
  applyDeclarativeI18n,
  applyDocumentLocale,
  detectBrowserLocale,
  isRtlLocale,
  normalizeLocale,
  CATALOGS,
  DEFAULT_LOCALE,
  FONT_PROFILES,
  t
} from '../i18n/index.js';

export const UI_STORAGE_KEY = 'earthRadio.ui.v1';
export const DEFAULT_SPLIT = 42;
export const MIN_LIST_PX = 340;
export const MIN_MAP_PX = 360;
export const MOBILE_MAX = 767;
export const TABLET_MAX = 1099;
export const DESTINATIONS = Object.freeze(['listen', 'search', 'map', 'saved']);

/** Column gap used by the recovered virtual list (`gap: 12`). */
export const GRID_GAP_PX = 12;

const COUNTRY_CODES = Object.freeze({
  'south korea': 'KR',
  'united kingdom': 'GB',
  'united states': 'US'
});

const COUNTRY_ALIASES = Object.freeze({
  britain: 'united kingdom',
  england: 'united kingdom',
  gb: 'united kingdom',
  kr: 'south korea',
  korea: 'south korea',
  uk: 'united kingdom',
  us: 'united states',
  usa: 'united states'
});

const COUNTRY_DISPLAY_NAMES = Object.freeze({
  'the republic of korea': 'South Korea',
  'republic of korea': 'South Korea',
  'the united states of america': 'United States',
  'united states of america': 'United States',
  'the united kingdom': 'United Kingdom',
  'united kingdom of great britain and northern ireland': 'United Kingdom'
});

function normalizeSearchTerm(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function countryFlag(code) {
  const normalized = String(code ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '';
  return String.fromCodePoint(...[...normalized].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

function displayCountryName(value) {
  const name = String(value ?? '').trim();
  return COUNTRY_DISPLAY_NAMES[normalizeSearchTerm(name)] || name;
}

const DISPLAY_REGION_CODES = (() => {
  const lookup = new Map(Object.entries(COUNTRY_CODES));
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first, second);
        const name = names.of(code);
        if (name && name !== code) lookup.set(normalizeSearchTerm(name), code);
      }
    }
  } catch {
    /* Older WebViews still receive the explicitly supported aliases above. */
  }
  return lookup;
})();

export function buildCountryOptions(entries) {
  const combined = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const name = displayCountryName(entry?.name);
    if (!name) continue;
    const key = normalizeSearchTerm(name);
    const count = Number.parseInt(String(entry?.count ?? 0).replace(/[^\d-]/g, ''), 10);
    const current = combined.get(key) || { name, count: 0 };
    current.count += Number.isFinite(count) ? Math.max(0, count) : 0;
    combined.set(key, current);
  }
  return [...combined.entries()]
    .map(([key, value]) => {
      const code = DISPLAY_REGION_CODES.get(key) || '';
      return { name: value.name, code, flag: countryFlag(code), count: value.count };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export function filterCountryOptions(options, query) {
  const term = normalizeSearchTerm(query);
  if (!term) return [...(Array.isArray(options) ? options : [])];
  const canonical = COUNTRY_ALIASES[term] || term;
  return (Array.isArray(options) ? options : []).filter(option => {
    const name = normalizeSearchTerm(option?.name);
    const code = normalizeSearchTerm(option?.code);
    return name.includes(canonical) || code === term;
  });
}

export function buildCountryStationQuery(country, stationQuery) {
  return [String(country ?? '').trim(), String(stationQuery ?? '').trim()].filter(Boolean).join(' ');
}

export function matchesSelectedCountry(metadata, selectedCountry) {
  const wanted = normalizeSearchTerm(displayCountryName(selectedCountry));
  if (!wanted) return true;
  const actual = normalizeSearchTerm(displayCountryName(String(metadata ?? '').split(/\s*[·•]\s*/, 1)[0]));
  return actual === wanted;
}

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

export function splitBounds(viewportWidth, minList = MIN_LIST_PX, minMap = MIN_MAP_PX) {
  const width = Number(viewportWidth);
  if (!Number.isFinite(width) || width < minList + minMap) {
    return { min: DEFAULT_SPLIT, max: DEFAULT_SPLIT };
  }
  return {
    min: Math.round((minList / width) * 100),
    max: Math.round(100 - (minMap / width) * 100)
  };
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
  const localeExplicit = typeof src.localeExplicit === 'boolean'
    ? src.localeExplicit
    : Object.prototype.hasOwnProperty.call(src, 'locale');
  return {
    version: 1,
    destination: DESTINATIONS.includes(src.destination) ? src.destination : 'listen',
    savedSegment: src.savedSegment === 'recent' ? 'recent' : 'favorites',
    collapsed: src.collapsed === 'map' || src.collapsed === 'list' ? src.collapsed : null,
    split: clampSplitPercent(src.split, Number(src.viewportWidth) || viewportWidth),
    locale: normalizeLocale(src.locale),
    localeExplicit
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
  const localeWasProvided = partial && Object.prototype.hasOwnProperty.call(partial, 'locale');
  const localeExplicitWasProvided = partial && Object.prototype.hasOwnProperty.call(partial, 'localeExplicit');
  const next = sanitizeUiState({
    ...loadUiState(),
    ...partial,
    ...(localeWasProvided && !localeExplicitWasProvided ? { localeExplicit: true } : {}),
    viewportWidth: globalThis.innerWidth || 1440
  });
  try {
    globalThis.localStorage?.setItem(UI_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Storage failure degrades to session-only presentation state. */
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * Runtime string localization
 *
 * The recovered runtime writes English (or Spanish/Arabic) text into a known,
 * enumerated set of elements. For locales the runtime does not carry, the
 * layer rewrites only those elements, and only when their current text is an
 * exact match for an English catalog entry or one of its placeholder
 * templates. No whole-document observation and no open-ended text scraping.
 * ------------------------------------------------------------------ */

const RUNTIME_TEXT_SCOPES = Object.freeze([
  { id: 'status-line', keys: ['status.'] },
  { id: 'grid-title', keys: ['grid.all', 'grid.favorites', 'grid.filtered', 'grid.recent', 'grid.similar'] },
  { id: 'grid-subtitle', keys: ['grid.subtitle'] },
  { id: 'grid-count', keys: ['grid.count', 'grid.countOne'] },
  { id: 'filter-summary', keys: ['filters.none', 'filters.active', 'filters.activeOne'] },
  { id: 'empty-state', keys: ['empty.'] },
  { id: 'toast-container', keys: ['toast.'] },
  { id: 'player-station', keys: ['player.select'] },
  { id: 'nowcard-eyebrow', keys: ['nowplaying.onAir'] },
  { id: 'sleep-menu', keys: ['sleep.'] }
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const REVERSE_INDEX = (() => {
  const entries = [];
  for (const [key, template] of Object.entries(CATALOGS[DEFAULT_LOCALE])) {
    const source = String(template);
    const names = [...source.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
    if (!names.length) {
      entries.push({ key, names, literal: source, pattern: null });
      continue;
    }
    const pattern = new RegExp(`^${source.split(/\{\w+\}/).map(escapeRegExp).join('(.+?)')}$`);
    entries.push({ key, names, literal: null, pattern });
  }
  // Literals first, and longer literals before shorter ones, so that specific
  // strings win over generic single-word entries.
  entries.sort((a, b) => (b.literal?.length ?? 0) - (a.literal?.length ?? 0));
  return entries;
})();

function scopeAllows(scope, key) {
  return scope.keys.some(allowed => (allowed.endsWith('.') ? key.startsWith(allowed) : key === allowed));
}

function translateRuntimeText(text, scope, locale) {
  const value = text.trim();
  if (!value) return null;
  for (const entry of REVERSE_INDEX) {
    if (!scopeAllows(scope, entry.key)) continue;
    if (entry.literal !== null) {
      if (entry.literal !== value) continue;
      return t(entry.key, undefined, locale);
    }
    const match = entry.pattern.exec(value);
    if (!match) continue;
    const params = {};
    entry.names.forEach((name, index) => {
      params[name] = match[index + 1];
    });
    return t(entry.key, params, locale);
  }
  return null;
}

function localizeRuntimeScope(scope, locale) {
  if (locale === DEFAULT_LOCALE) return;
  const root = byId(scope.id);
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pending = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const translated = translateRuntimeText(node.nodeValue, scope, locale);
    if (translated && translated !== node.nodeValue.trim()) pending.push([node, translated]);
  }
  for (const [node, translated] of pending) node.nodeValue = translated;
}

function localizeRuntime(locale) {
  for (const scope of RUNTIME_TEXT_SCOPES) localizeRuntimeScope(scope, locale);
}

/* ------------------------------------------------------------------ *
 * DOM helpers
 * ------------------------------------------------------------------ */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let mapInvalidateFrame = 0;
let focusReturn = null;

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

/**
 * Ask Leaflet to re-measure. The recovered map enables `trackResize`, so a
 * window resize is the supported additive route to `invalidateSize()`.
 * Throttled to one frame while dragging; `flush` runs it immediately.
 */
function invalidateMap(flush = false) {
  if (flush) {
    if (mapInvalidateFrame) cancelAnimationFrame(mapInvalidateFrame);
    mapInvalidateFrame = 0;
    window.dispatchEvent(new Event('resize'));
    return;
  }
  if (mapInvalidateFrame) return;
  mapInvalidateFrame = requestAnimationFrame(() => {
    mapInvalidateFrame = 0;
    window.dispatchEvent(new Event('resize'));
  });
}

function focusFirst(container) {
  const target = container?.querySelector(FOCUSABLE);
  // Run after the activating button's default focus behavior, otherwise a
  // trusted pointer click can immediately steal focus back from the surface.
  if (target) setTimeout(() => target.focus(), 0);
  return Boolean(target);
}

function restoreFocus(fallbackId) {
  const target = focusReturn && document.contains(focusReturn) ? focusReturn : byId(fallbackId);
  focusReturn = null;
  if (target) queueMicrotask(() => target.focus?.());
}

/* ------------------------------------------------------------------ *
 * Locale
 * ------------------------------------------------------------------ */

export function resolveInitialLocale(state, browserLocales = []) {
  if (state?.localeExplicit) return normalizeLocale(state.locale);
  return detectBrowserLocale(browserLocales);
}

/**
 * Keep the Settings selection, its transient preview, and its stored locale
 * distinct. This pure transition is shared by the DOM paths so it remains
 * verifiable when a rendered Electron harness is unavailable.
 */
export function advanceLocalePreview(state, action = {}) {
  const persistedLocale = normalizeLocale(state?.persistedLocale);
  const selectedLocale = normalizeLocale(state?.selectedLocale ?? state?.previewLocale ?? persistedLocale);
  const previewLocale = state?.previewLocale ? normalizeLocale(state.previewLocale) : null;

  if (action.type === 'preview') {
    const next = normalizeLocale(action.locale);
    return {
      persistedLocale,
      previewLocale: next === persistedLocale ? null : next,
      selectedLocale: next
    };
  }
  if (action.type === 'save') {
    return { persistedLocale: selectedLocale, previewLocale: null, selectedLocale };
  }
  if (action.type === 'dismiss') {
    return { persistedLocale, previewLocale: null, selectedLocale: persistedLocale };
  }
  return { persistedLocale, previewLocale, selectedLocale };
}

function readLocale(state) {
  if (state?.localeExplicit) return normalizeLocale(state.locale);
  const select = byId('setting-locale');
  if (select?.value) {
    const fromSelect = normalizeLocale(select.value);
    if (fromSelect !== DEFAULT_LOCALE) return fromSelect;
  }
  return resolveInitialLocale(state, [navigator.language, ...(navigator.languages || [])]);
}

/**
 * Own `lang`, `dir`, and the locale font variable. The runtime rewrites both
 * attributes from its own three-locale table, so they are re-asserted here and
 * defended by a narrowly scoped attribute observer.
 */
function applyLocale(locale) {
  const resolved = normalizeLocale(locale);
  applyDocumentLocale(resolved);
  applyDeclarativeI18n(document, resolved);
  localizeRuntime(resolved);
  refreshCountryPresentation();

  const select = byId('setting-locale');
  if (select && [...select.options].some(option => option.value === resolved)) select.value = resolved;
  return resolved;
}

function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = document.documentElement.dataset.theme === 'dark' ? '#171626' : '#25243D';
}

export function resolveThemePreference(preference, systemDark = false) {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return systemDark ? 'dark' : 'light';
}

// The runtime's authoritative preference store is IndexedDB (kv/prefs); the legacy
// localStorage key only serves migrated-from profiles and the synchronous first
// paint. Policing data-theme from the legacy key alone overwrote the user's saved
// choice on any profile where that key is absent or stale.
let themePreference = null;
let themePreferenceHydration = null;

function hydrateThemePreference() {
  if (themePreferenceHydration) return themePreferenceHydration;
  themePreferenceHydration = new Promise(resolve => {
    if (!globalThis.indexedDB) {
      resolve(null);
      return;
    }
    let request;
    try {
      request = globalThis.indexedDB.open('earthRadio', 1);
    } catch {
      resolve(null);
      return;
    }
    request.onerror = () => resolve(null);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve(null);
    };
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('kv')) {
        database.close();
        resolve(null);
        return;
      }
      const transaction = database.transaction('kv', 'readonly');
      const get = transaction.objectStore('kv').get('prefs');
      get.onerror = () => resolve(null);
      get.onsuccess = () => {
        const theme = get.result?.theme;
        resolve(['system', 'light', 'dark'].includes(theme) ? theme : null);
      };
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => database.close();
    };
  }).then(preference => {
    themePreferenceHydration = null;
    if (preference) themePreference = preference;
    return preference;
  });
  return themePreferenceHydration;
}

function readStoredTheme() {
  let preference = themePreference;
  if (!preference) {
    preference = 'system';
    try {
      const preferences = JSON.parse(globalThis.localStorage?.getItem('earthRadio.preferences.v1') || 'null');
      if (['system', 'light', 'dark'].includes(preferences?.theme)) preference = preferences.theme;
    } catch {
      /* Invalid recovered preferences safely fall back to the system palette. */
    }
  }
  return resolveThemePreference(preference, Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches));
}

function restoreStoredTheme() {
  const theme = readStoredTheme();
  document.documentElement.dataset.theme = theme;
  syncThemeColor();
  void hydrateThemePreference().then(preference => {
    if (!preference) return;
    const fresh = readStoredTheme();
    if (document.documentElement.dataset.theme !== fresh) {
      document.documentElement.dataset.theme = fresh;
      syncThemeColor();
    }
  });
}

let previewLocale = null;

function effectiveLocale() {
  return previewLocale ?? normalizeLocale(loadUiState().locale);
}

function transitionLocalePreview(type, selectedLocale) {
  const next = advanceLocalePreview({
    persistedLocale: loadUiState().locale,
    previewLocale,
    selectedLocale
  }, { type, locale: selectedLocale });
  previewLocale = next.previewLocale;
  return next;
}

function previewLocaleSelection(locale) {
  const next = transitionLocalePreview('preview', locale);
  applyLocale(next.selectedLocale);
  return next;
}

function dismissLocalePreview() {
  const next = transitionLocalePreview('dismiss');
  applyLocale(next.selectedLocale);
  return next;
}

function saveLocalePreview(locale) {
  const next = transitionLocalePreview('save', locale);
  const saved = saveUiState({ locale: next.persistedLocale, localeExplicit: true });
  previewLocale = null;
  applyLocale(saved.locale);
  return saved;
}

function settingsModalIsVisible(modal) {
  return Boolean(modal && !modal.hidden && modal.style.display !== 'none' && modal.getAttribute('aria-hidden') !== 'true');
}

function guardDocumentLocale() {
  const observer = new MutationObserver(() => {
    const wanted = effectiveLocale();
    const dir = isRtlLocale(wanted) ? 'rtl' : 'ltr';
    if (document.documentElement.lang !== wanted) document.documentElement.lang = wanted;
    if (document.documentElement.dir !== dir) document.documentElement.dir = dir;
    if (document.documentElement.dataset.fontProfile !== wanted) {
      document.documentElement.dataset.fontProfile = wanted;
      document.documentElement.style.setProperty('--er-font', FONT_PROFILES[wanted]);
    }
    const wantedTheme = readStoredTheme();
    if (document.documentElement.dataset.theme !== wantedTheme) {
      // The runtime may have just persisted a different choice; re-read the
      // authoritative store before enforcing rather than stomping a fresh save
      // with a stale or legacy value.
      themePreference = null;
      void hydrateThemePreference().then(() => {
        const fresh = readStoredTheme();
        if (document.documentElement.dataset.theme !== fresh) {
          document.documentElement.dataset.theme = fresh;
        }
        syncThemeColor();
      });
      return;
    }
    syncThemeColor();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir', 'data-font-profile', 'data-theme'] });
  globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', () => restoreStoredTheme());
  syncThemeColor();
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
  // The runtime persists a lowercased locale, which no longer matches the
  // canonical `zh-Hans` / `zh-Hant` option values. Restore the canonical id.
  const normalized = normalizeLocale(select.value || loadUiState().locale);
  if ([...select.options].some(option => option.value === normalized)) select.value = normalized;

  select.addEventListener('change', () => {
    // Preview only; the Save button commits and closing the modal reverts.
    previewLocaleSelection(select.value);
    applyViewport(loadUiState());
  });

  const modal = byId('settings-modal');
  if (modal) {
    let wasVisible = settingsModalIsVisible(modal);
    const restorePersistedLocale = () => {
      dismissLocalePreview();
      wasVisible = false;
    };
    modal.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('[data-close-settings]')) restorePersistedLocale();
    }, true);
    new MutationObserver(() => {
      const visible = settingsModalIsVisible(modal);
      if (visible === wasVisible) return;
      wasVisible = visible;
      // Opening also clears any interrupted/stale preview before the runtime
      // repopulates Settings; hidden/style/aria-hidden all reach this path.
      dismissLocalePreview();
    }).observe(modal, { attributes: true, attributeFilter: ['hidden', 'style', 'aria-hidden'] });
  }
}

/* ------------------------------------------------------------------ *
 * Viewport, safe areas, chrome metrics
 * ------------------------------------------------------------------ */

function measureSafeAreaBottom() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-9999px;bottom:0;width:1px;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px);';
  document.body.append(probe);
  const inset = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(inset) ? Math.round(inset) : 0;
}

function applyModeClasses(mode) {
  const root = document.documentElement;
  root.classList.toggle('er-mobile', mode === 'mobile');
  root.classList.toggle('er-tablet', mode === 'tablet');
  root.classList.toggle('er-desktop', mode === 'desktop');
  root.classList.toggle('er-standalone', isStandalone());
  root.classList.toggle('er-desktop-app', Boolean(window.earthRadio?.isDesktop));
  const landscape = window.innerWidth > window.innerHeight;
  root.classList.toggle('er-landscape', landscape);
  root.classList.toggle('er-portrait', !landscape);
  const safeBottom = measureSafeAreaBottom();
  root.classList.toggle('er-has-safe-bottom', safeBottom > 0);
  root.style.setProperty('--er-safe-bottom-px', `${safeBottom}px`);
}

/**
 * Publish the real chrome heights so the fixed Search destination, the
 * overflow sheet, and the workspace height math stay in sync with whatever the
 * runtime and the current locale actually render. Values are only written when
 * they move by more than a pixel, which keeps the measurement stable even
 * though the measured elements size themselves from the same variables.
 */
function syncChromeMetrics() {
  const root = document.documentElement;
  const rootStyle = getComputedStyle(root);
  const measurements = [
    ['--er-header', document.querySelector('header.header'), '--er-safe-top'],
    ['--er-nav', document.querySelector('.er-mobile-nav'), '--er-safe-bottom']
  ];
  for (const [name, element, insetName] of measurements) {
    if (!element || element.hidden) continue;
    const inset = parseFloat(rootStyle.getPropertyValue(insetName)) || 0;
    const height = Math.round(element.getBoundingClientRect().height - inset);
    if (!height) continue;
    // A presentation layer may restyle a chrome element into a full-height
    // rail (fixed, pinned top and bottom). Its height is then the viewport,
    // not chrome depth; adopting it would poison every inset derived from
    // this variable and, via the header's own min-height, latch permanently.
    if (height > window.innerHeight / 2) continue;
    const current = parseFloat(root.style.getPropertyValue(name));
    if (Number.isFinite(current) && Math.abs(current - height) <= 1) continue;
    root.style.setProperty(name, `${height}px`);
  }
  root.style.setProperty('--er-vh', `${window.innerHeight}px`);
}

/**
 * Keep the presentation layer's card sizing aligned with the recovered virtual
 * list, which positions cards absolutely on a fixed row stride. The stride is
 * read back from the rendered rows rather than assumed, so a runtime change to
 * `rowHeight` cannot leave the cards overlapping.
 */
function syncVirtualRows() {
  const grid = byId('station-grid');
  const root = document.documentElement;
  const cards = grid ? [...grid.querySelectorAll('.station-card')] : [];
  if (cards.length < 2) return;
  const tops = [...new Set(cards.map(card => Math.round(card.offsetTop)))].sort((a, b) => a - b);
  let stride = 0;
  for (let index = 1; index < tops.length; index += 1) {
    const delta = tops[index] - tops[index - 1];
    if (delta > 0 && (!stride || delta < stride)) stride = delta;
  }
  const columns = cards.filter(card => Math.round(card.offsetTop) === tops[0]).length;
  root.style.setProperty('--er-row-cols', String(Math.max(1, columns)));
  if (!stride) return;
  root.style.setProperty('--er-row-h', `${stride}px`);
  root.style.setProperty('--er-card-h', `${Math.max(64, stride - GRID_GAP_PX)}px`);
}

function applyViewport(state) {
  const mode = classifyViewport();
  applyModeClasses(mode);
  const root = document.documentElement;
  root.dataset.erDest = state.destination;
  root.dataset.erSaved = state.savedSegment;
  root.dataset.erCollapsed = state.collapsed || '';
  root.dataset.erMode = mode;
  root.style.setProperty('--er-list-pct', `${state.split}%`);

  for (const button of document.querySelectorAll('[data-er-dest]')) {
    const active = button.getAttribute('data-er-dest') === state.destination;
    // `aria-current` belongs to the bottom navigation only; the Now Playing
    // "Show on map" shortcut reuses the attribute hook but is not a destination.
    if (button.closest('.er-mobile-nav') || button.classList.contains('er-icon-btn')) {
      button.setAttribute('aria-current', active ? 'page' : 'false');
    }
    button.classList.toggle('is-active', active);
  }
  for (const button of document.querySelectorAll('[data-er-saved]')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-er-saved') === state.savedSegment));
  }

  applyWorkspace(state, mode);
  syncChromeMetrics();
  syncVirtualRows();
}

// Split percentages apply to main's width, which a presentation layer may
// inset from the viewport (the desktop rail); clamping and reporting bounds
// against window.innerWidth would let the panels drop below their pixel
// floors and desynchronize the separator's ARIA bounds.
function workspaceWidth() {
  const width = document.querySelector('main.main')?.getBoundingClientRect().width;
  return width || window.innerWidth;
}

function applyWorkspace(state, mode) {
  const list = byId('grid-panel');
  const map = byId('map-panel');
  const separator = byId('er-separator');
  const restore = byId('er-restore-panel');
  if (!list || !map) return;

  const showRestore = target => {
    if (!restore) return;
    restore.hidden = !target;
    restore.setAttribute('data-er-collapse', target || 'map');
    const key = target === 'list' ? 'desktop.restoreStations' : 'desktop.restoreMap';
    // Keep the declarative key in sync; applyDeclarativeI18n would otherwise rewrite
    // the label back on its next pass.
    restore.setAttribute('data-i18n', key);
    restore.textContent = t(key);
  };

  if (mode === 'mobile') {
    list.hidden = state.destination === 'map' || state.destination === 'search';
    map.hidden = state.destination !== 'map';
    if (separator) {
      separator.hidden = true;
      separator.setAttribute('aria-hidden', 'true');
    }
    showRestore(null);
    presentSearch(state.destination === 'search');
    return;
  }

  presentSearch(false);

  if (mode === 'tablet') {
    // Below the split threshold the panels become explicit List/Map modes.
    const showMap = state.destination === 'map' || state.collapsed === 'list';
    list.hidden = showMap;
    map.hidden = !showMap;
    if (separator) {
      separator.hidden = true;
      separator.setAttribute('aria-hidden', 'true');
    }
    showRestore(null);
    return;
  }

  list.hidden = state.collapsed === 'list';
  map.hidden = state.collapsed === 'map';
  if (separator) {
    // A collapsed studio has nothing to resize: the separator leaves the
    // accessibility tree entirely rather than exposing a dead control.
    separator.hidden = Boolean(state.collapsed);
    separator.setAttribute('aria-hidden', String(Boolean(state.collapsed)));
    const bounds = splitBounds(workspaceWidth());
    separator.setAttribute('aria-valuemin', String(bounds.min));
    separator.setAttribute('aria-valuemax', String(bounds.max));
    separator.setAttribute('aria-valuenow', String(Math.round(state.split)));
    separator.setAttribute('aria-valuetext', `${Math.round(state.split)}%`);
  }
  showRestore(state.collapsed);
}

/* ------------------------------------------------------------------ *
 * Search destination and IME
 * ------------------------------------------------------------------ */

function presentSearch(active, focusInput = false) {
  const modal = byId('search-modal');
  if (!modal) return;
  const wasDestination = modal.classList.contains('er-search-destination');
  modal.classList.toggle('er-search-destination', active);
  if (active) {
    modal.hidden = false;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    // The Search destination is a region, not a modal dialog.
    modal.setAttribute('aria-modal', 'false');
    modal.setAttribute('role', 'region');
    // The iOS keyboard rises only on an explicit Search activation.
    if (focusInput) queueMicrotask(() => byId('er-station-query')?.focus());
    return;
  }
  if (!wasDestination) return;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.hidden = true;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  byId('er-station-query')?.blur();
  byId('er-country-query')?.blur();
}

/**
 * Korean and Chinese IME input must not filter mid-composition: the runtime's
 * `input` handler is suppressed in the capture phase until `compositionend`,
 * then replayed once with the settled value.
 */
function bindSearchIme() {
  const input = byId('search-input');
  if (!input || input.dataset.erIme === '1') return;
  input.dataset.erIme = '1';
  let composing = false;

  input.addEventListener('compositionstart', () => {
    composing = true;
  }, true);

  input.addEventListener('compositionend', () => {
    composing = false;
    queueMicrotask(() => input.dispatchEvent(new Event('input', { bubbles: true })));
  }, true);

  input.addEventListener('input', event => {
    if (composing || event.isComposing) event.stopImmediatePropagation();
  }, true);

  // Enter and the arrow keys select search results; while an IME candidate
  // window is open they belong to the IME, not to the result list.
  input.addEventListener('keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229) event.stopImmediatePropagation();
  }, true);
}

let countryOptions = [];
let countryRuntimeNames = new Map();
let selectedCountry = '';
let stationQuery = '';
let activeCountryIndex = -1;
let countrySearchBound = false;
let runtimeSearchStations = null;
let runtimeSearchStationsPromise = null;

function countryFilterEntries() {
  return [...document.querySelectorAll('#filter-countries .filter-item')].map(item => ({
    name: item.querySelector('input')?.value || item.querySelector('span')?.textContent || '',
    count: item.querySelector('.filter-count')?.textContent || 0
  }));
}

function setCountryOptionsOpen(open) {
  const input = byId('er-country-query');
  const list = byId('er-country-options');
  if (!input || !list) return;
  list.hidden = !open;
  input.setAttribute('aria-expanded', String(open));
  if (!open) {
    activeCountryIndex = -1;
    input.removeAttribute('aria-activedescendant');
  }
}

function renderCountryOptions(query = '') {
  const list = byId('er-country-options');
  const input = byId('er-country-query');
  if (!list || !input) return;
  const filtered = filterCountryOptions(countryOptions, query);
  const visible = query ? filtered : [{ name: '', code: '', flag: '🌐', count: countryOptions.reduce((sum, option) => sum + option.count, 0) }, ...filtered];
  activeCountryIndex = visible.length && activeCountryIndex >= 0
    ? Math.min(activeCountryIndex, visible.length - 1)
    : -1;
  list.replaceChildren();

  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'er-country-no-match';
    empty.textContent = t('search.countryNoMatch');
    list.append(empty);
    return;
  }

  visible.forEach((option, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `er-country-option-${index}`;
    button.className = `er-country-option${index === activeCountryIndex ? ' is-active' : ''}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(option.name === selectedCountry));
    button.dataset.country = option.name;

    const flag = document.createElement('span');
    flag.setAttribute('aria-hidden', 'true');
    flag.textContent = option.flag || '•';
    const name = document.createElement('span');
    name.className = 'er-country-option-name';
    name.textContent = option.name || t('search.allCountries');
    const code = document.createElement('span');
    code.className = 'er-country-option-code';
    code.textContent = option.code;
    const count = document.createElement('span');
    count.className = 'er-country-option-count';
    count.textContent = String(option.count);
    button.append(flag, name, code, count);
    button.addEventListener('click', () => selectCountry(option.name));
    list.append(button);
  });
}

function updateCountryActive(delta) {
  const options = [...document.querySelectorAll('#er-country-options [role="option"]')];
  if (!options.length) return;
  activeCountryIndex = (activeCountryIndex + delta + options.length) % options.length;
  options.forEach((option, index) => option.classList.toggle('is-active', index === activeCountryIndex));
  const active = options[activeCountryIndex];
  byId('er-country-query')?.setAttribute('aria-activedescendant', active.id);
  active.scrollIntoView({ block: 'nearest' });
}

function updateCountrySummary() {
  const summary = byId('er-country-summary');
  if (!summary) return;
  if (!selectedCountry) {
    const count = [...document.querySelectorAll('#search-results .search-result-item:not([hidden]):not(.search-result-item--empty)')].length;
    summary.textContent = stationQuery && !count ? t('search.noMatch') : '';
    return;
  }
  const count = [...document.querySelectorAll('#search-results .search-result-item:not([hidden])')].length;
  if (count) summary.textContent = t('search.resultSummary', { count, country: selectedCountry });
  else summary.textContent = t(stationQuery ? 'search.noStationsForQuery' : 'search.noStationsInCountry', { country: selectedCountry });
}

function readRuntimeSearchStations() {
  if (runtimeSearchStationsPromise) return runtimeSearchStationsPromise;
  const pending = new Promise(resolve => {
    if (!globalThis.indexedDB) {
      resolve(null);
      return;
    }
    const request = globalThis.indexedDB.open('earthRadio', 1);
    request.onerror = () => resolve(null);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve(null);
    };
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('cache')) {
        database.close();
        resolve(null);
        return;
      }
      const transaction = database.transaction('cache', 'readonly');
      const get = transaction.objectStore('cache').get('stations.v3');
      get.onerror = () => resolve(null);
      get.onsuccess = () => {
        const stations = Array.isArray(get.result?.stations) ? get.result.stations : null;
        resolve(stations);
      };
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => database.close();
    };
  }).then(stations => {
    // Commit only while still current: an invalidation (a settled directory load)
    // may have started a fresh read that this older one must not clobber.
    if (runtimeSearchStationsPromise === pending) {
      runtimeSearchStations = stations;
      runtimeSearchStationsPromise = null;
    }
    return stations;
  });
  runtimeSearchStationsPromise = pending;
  return pending;
}

function stationResultMatches(result) {
  const wanted = normalizeSearchTerm(stationQuery);
  if (!wanted) return true;
  const terms = wanted.split(' ');
  const visibleHaystack = normalizeSearchTerm(result.textContent || '');
  if (terms.every(term => visibleHaystack.includes(term))) return true;
  // The runtime's IndexedDB record is the authoritative catalog. It lets the
  // presentation layer validate tag/language matches without depending on the
  // handful of station cards currently mounted by the virtual list.
  if (!Array.isArray(runtimeSearchStations)) return true;
  const name = (result.querySelector('.search-result-item__name')?.textContent || '').trim();
  const metadata = result.querySelector('.search-result-item__meta')?.textContent || '';
  return runtimeSearchStations.some(station => {
    if (String(station?.name || '').trim() !== name) return false;
    if (!matchesSelectedCountry(metadata, station?.country)) return false;
    const haystack = normalizeSearchTerm([
      station.name,
      station.country,
      station.countrycode,
      station.tags,
      station.language,
      station.codec,
      station.bitrate
    ].filter(Boolean).join(' '));
    return terms.every(term => haystack.includes(term));
  });
}

function applySearchScope() {
  for (const result of document.querySelectorAll('#search-results .search-result-item')) {
    const meta = result.querySelector('.search-result-item__meta')?.textContent || '';
    const shouldHide = result.classList.contains('search-result-item--empty')
      ? Boolean(selectedCountry || stationQuery)
      : !matchesSelectedCountry(meta, selectedCountry) || !stationResultMatches(result);
    if (result.hidden !== shouldHide) result.hidden = shouldHide;
  }
  updateCountrySummary();
}

function syncRuntimeSearch() {
  const engine = byId('search-input');
  if (!engine) return;
  engine.value = buildCountryStationQuery(countryRuntimeNames.get(selectedCountry) || selectedCountry, stationQuery);
  engine.dispatchEvent(new Event('input', { bubbles: true }));
  queueMicrotask(applySearchScope);
  void readRuntimeSearchStations().then(() => applySearchScope());
}

function visibleSearchResults() {
  return [...document.querySelectorAll('#search-results .search-result-item:not([hidden]):not(.search-result-item--empty)')];
}

function markActivatedSearchResult(result) {
  const name = result?.querySelector('.search-result-item__name')?.textContent?.trim();
  if (!name) return false;
  for (const item of document.querySelectorAll('#search-results [data-er-activated]')) {
    item.removeAttribute('data-er-activated');
  }
  result.setAttribute('data-er-activated', 'true');
  return true;
}

function navigateVisibleSearchResults(delta) {
  const results = visibleSearchResults();
  if (!results.length) return;
  const current = results.findIndex(result => result.classList.contains('search-result-item--active'));
  const next = current < 0
    ? (delta > 0 ? 0 : results.length - 1)
    : (current + delta + results.length) % results.length;
  for (const result of document.querySelectorAll('#search-results .search-result-item')) {
    const active = result === results[next];
    result.classList.toggle('search-result-item--active', active);
    result.setAttribute('aria-selected', String(active));
  }
  results[next].scrollIntoView({ block: 'nearest' });
}

function selectCountry(country) {
  selectedCountry = String(country || '').trim();
  if (selectedCountry) {
    document.dispatchEvent(new CustomEvent('earthradio:country-selected', { detail: { country: selectedCountry } }));
  }
  const input = byId('er-country-query');
  const clear = byId('er-country-clear');
  if (input) input.value = selectedCountry;
  if (clear) clear.hidden = !selectedCountry;
  setCountryOptionsOpen(false);
  syncRuntimeSearch();
  byId('er-station-query')?.focus();
}

function refreshCountryPresentation() {
  if (!countrySearchBound) return;
  renderCountryOptions('');
  const input = byId('er-country-query');
  if (input && !selectedCountry) input.placeholder = t('search.countryPlaceholder');
  updateCountrySummary();
}

function bindSettledInput(input, callback) {
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => {
    composing = false;
    callback();
  });
  input.addEventListener('input', event => {
    if (!composing && !event.isComposing) callback();
  });
  return () => composing;
}

function bindCountrySearch() {
  if (countrySearchBound) return;
  const engine = byId('search-input');
  const station = byId('er-station-query');
  const country = byId('er-country-query');
  const options = byId('er-country-options');
  const countries = byId('filter-countries');
  if (!engine || !station || !country || !options || !countries) return;
  countrySearchBound = true;

  const syncCountries = () => {
    const entries = countryFilterEntries();
    countryRuntimeNames = new Map(entries.map(entry => [displayCountryName(entry.name), entry.name]));
    countryOptions = buildCountryOptions(entries);
    renderCountryOptions(country.value && country.value !== selectedCountry ? country.value : '');
  };
  syncCountries();
  new MutationObserver(syncCountries).observe(countries, { childList: true, subtree: true });
  let countryScopeQueued = false;
  new MutationObserver(() => {
    if (countryScopeQueued) return;
    countryScopeQueued = true;
    queueMicrotask(() => {
      countryScopeQueued = false;
      applySearchScope();
    });
  }).observe(byId('search-results'), { childList: true, subtree: true });

  const stationIsComposing = bindSettledInput(station, () => {
    stationQuery = station.value;
    syncRuntimeSearch();
  });
  bindSettledInput(country, () => {
    if (country.value === selectedCountry) return;
    activeCountryIndex = -1;
    renderCountryOptions(country.value);
    setCountryOptionsOpen(true);
  });

  station.addEventListener('keydown', event => {
    if (stationIsComposing() || event.isComposing || event.keyCode === 229) return;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
    if (event.key === 'Escape' && station.value) {
      event.preventDefault();
      station.value = '';
      stationQuery = '';
      syncRuntimeSearch();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      navigateVisibleSearchResults(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const results = visibleSearchResults();
      (results.find(result => result.classList.contains('search-result-item--active')) || results[0])?.click();
      return;
    }
    engine.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, bubbles: true, cancelable: true }));
    // Re-present only the mobile search destination; on desktop the palette must close.
    if (event.key === 'Escape' && classifyViewport() === 'mobile' && loadUiState().destination === 'search') {
      queueMicrotask(() => presentSearch(true));
    }
  });

  country.addEventListener('focus', () => {
    renderCountryOptions(country.value === selectedCountry ? '' : country.value);
    setCountryOptionsOpen(true);
  });
  country.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setCountryOptionsOpen(true);
      updateCountryActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      const active = options.querySelectorAll('[role="option"]')[activeCountryIndex];
      const typed = displayCountryName(country.value);
      if (active || typed) {
        event.preventDefault();
        selectCountry(active?.dataset.country || typed);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      country.value = selectedCountry;
      setCountryOptionsOpen(false);
    }
  });

  byId('er-country-clear')?.addEventListener('click', () => selectCountry(''));
  document.addEventListener('pointerdown', event => {
    if (!(event.target instanceof Element) || !event.target.closest('.er-country-picker')) setCountryOptionsOpen(false);
  });
}

/* ------------------------------------------------------------------ *
 * Overflow sheet
 * ------------------------------------------------------------------ */

function setOverflowOpen(open, invoker = null, restore = true) {
  const sheet = byId('er-overflow');
  const toggle = document.querySelector('[data-er-overflow]');
  if (!sheet) return;
  const wasOpen = !sheet.hidden;
  sheet.hidden = !open;
  sheet.setAttribute('aria-hidden', String(!open));
  toggle?.setAttribute('aria-expanded', String(open));
  if (open) {
    focusReturn = invoker || toggle;
    focusFirst(sheet);
  } else if (wasOpen && restore) {
    restoreFocus('er-overflow-toggle');
  } else if (wasOpen) {
    focusReturn = null;
  }
}

function focusProxySurface(targetId) {
  const surface = targetId === 'settings-toggle' ? byId('settings-modal')
    : targetId === 'filters-toggle' ? byId('filter-sidebar')
      : null;
  if (!surface) return;
  queueMicrotask(() => surface.querySelector(FOCUSABLE)?.focus?.({ preventScroll: true }));
}

/* ------------------------------------------------------------------ *
 * Destinations
 * ------------------------------------------------------------------ */

function setDestination(destination, explicit = false) {
  const next = saveUiState({ destination });
  if (destination === 'saved') applySavedSegment(next.savedSegment);
  if (destination === 'listen') {
    // Listen is the unfiltered feed: release the Saved segment toggles.
    const recent = byId('recent-toggle');
    const favorites = byId('favorites-toggle');
    const isOn = element => element?.classList.contains('header-btn--active')
      || element?.getAttribute('aria-pressed') === 'true';
    if (isOn(recent)) recent.click();
    if (isOn(favorites)) favorites.click();
  }
  applyViewport(next);
  setOverflowOpen(false);
  if (destination === 'search' && explicit) presentSearch(true, true);
  if (explicit) {
    const current = location.hash.replace(/^#/, '');
    // Never clobber a runtime-owned hash such as `#station=...`.
    if (!current.includes('=')) history.replaceState(history.state, '', `#${destination}`);
  }
  invalidateMap(true);
  queueMicrotask(syncVirtualRows);
  return next;
}

function applySavedSegment(segment) {
  const wanted = segment === 'recent' ? 'recent' : 'favorites';
  const recent = byId('recent-toggle');
  const favorites = byId('favorites-toggle');
  const isOn = element => element?.classList.contains('header-btn--active')
    || element?.getAttribute('aria-pressed') === 'true';
  if (wanted === 'recent') {
    if (isOn(favorites)) favorites?.click();
    if (!isOn(recent)) recent?.click();
  } else {
    if (isOn(recent)) recent?.click();
    if (!isOn(favorites)) favorites?.click();
  }
  saveUiState({ savedSegment: wanted, destination: 'saved' });
}

/* ------------------------------------------------------------------ *
 * Now Playing
 * ------------------------------------------------------------------ */

let pendingNowPlayingDestination = null;

function openNowPlaying(invoker = null, push = true) {
  const panel = byId('er-nowplaying');
  if (!panel || panel.classList.contains('is-open')) return;
  focusReturn = invoker || document.activeElement;
  syncNowPlaying();
  panel.hidden = false;
  panel.classList.add('is-open');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', classifyViewport() === 'mobile' ? 'true' : 'false');
  panel.setAttribute('aria-label', t('nowplaying.label'));
  document.documentElement.classList.add('er-nowplaying-open');
  // Transient history state so Back closes Now Playing before leaving the app.
  if (push) history.pushState({ ...(history.state || {}), erNowPlaying: true }, '');
  queueMicrotask(() => byId('er-nowplaying-dismiss')?.focus());
}

function closeNowPlaying() {
  const panel = byId('er-nowplaying');
  if (!panel) return;
  const wasOpen = panel.classList.contains('is-open');
  panel.hidden = true;
  panel.classList.remove('is-open');
  panel.setAttribute('aria-modal', 'false');
  document.documentElement.classList.remove('er-nowplaying-open');
  if (wasOpen) restoreFocus('er-open-nowplaying');
}

export function nowPlayingSheetCopy({ station = '', facts = '', trackTitle = '', trackArtist = '', playerTrack = '' } = {}) {
  const stationName = String(station || '').trim();
  const liveLine = String(playerTrack || '').trim();
  const factsLine = String(facts || '').trim();
  // The recovered runtime can write raw ICY into #nowcard-title before the overlay
  // decides it is trustworthy. Only the promoted player-track line is that signal.
  const promoted = Boolean(liveLine) && liveLine !== stationName;
  if (!promoted) return { title: stationName, meta: factsLine };
  const song = String(trackTitle || '').trim();
  const artistLine = String(trackArtist || '').trim();
  const usableSong = Boolean(song) && song !== '-' && song !== stationName;
  if (usableSong) return { title: song, meta: artistLine || liveLine || factsLine };
  const parts = liveLine.split(/\s\u2013\s|\s-\s/).map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { title: parts.slice(1).join(' - '), meta: parts[0] };
  return { title: liveLine, meta: factsLine };
}

function syncNowPlaying() {
  const title = byId('er-nowplaying-title');
  const meta = byId('er-nowplaying-meta');
  const live = byId('er-nowplaying-live');
  const art = byId('er-nowplaying-art');
  const copy = nowPlayingSheetCopy({
    station: byId('player-station')?.textContent,
    facts: byId('player-meta')?.textContent,
    trackTitle: byId('nowcard-title')?.textContent,
    trackArtist: byId('nowcard-artist')?.textContent,
    playerTrack: byId('player-track')?.textContent
  });
  if (title) title.textContent = copy.title || t('player.select');
  if (meta) meta.textContent = copy.meta || '';
  if (live) {
    const audio = byId('audio-player');
    live.textContent = audio && !audio.paused ? t('nowplaying.live') : t('player.live');
  }
  const sourceArt = byId('nowcard-art');
  if (art && sourceArt) art.replaceChildren(...[...sourceArt.cloneNode(true).childNodes]);
  const favorite = byId('btn-favorite');
  const proxy = document.querySelector('#er-nowplaying [data-click-id="btn-favorite"]');
  if (favorite && proxy) proxy.setAttribute('aria-pressed', favorite.getAttribute('aria-pressed') || 'false');
  const play = byId('btn-play');
  const playProxy = document.querySelector('#er-nowplaying [data-er-nowplaying-play]');
  if (play && playProxy) {
    const label = play.getAttribute('aria-label') || t('player.play');
    playProxy.textContent = label;
    playProxy.setAttribute('aria-label', label);
  }
  syncNowPlayingMetadata();
}

function cloneWithoutIds(source) {
  const clone = source.cloneNode(true);
  linkClonedFingerprintAction(clone);
  if (clone instanceof Element) {
    clone.removeAttribute('id');
    for (const element of clone.querySelectorAll('[id]')) element.removeAttribute('id');
  }
  return clone;
}

// cloneNode intentionally does not copy event listeners. Mark the cloned Identify
// button as a proxy for the canonical metadata control; the shared action router then
// invokes the one fingerprint state machine, while runtime observation re-clones its
// disabled/text/status state into the open Now Playing surface.
export function linkClonedFingerprintAction(clone) {
  const button = clone?.querySelector?.('#metadata-fingerprint-btn');
  if (!button) return false;
  button.setAttribute('data-click-id', 'metadata-fingerprint-btn');
  return true;
}

function syncNowPlayingMetadata() {
  const destination = byId('er-nowplaying-metadata');
  if (!destination) return;
  const card = byId('metadata-card');
  const links = byId('nowcard-links');
  const nodes = [];
  if (card) nodes.push(cloneWithoutIds(card));
  if (links?.childElementCount) nodes.push(cloneWithoutIds(links));
  if (!nodes.length) {
    const status = document.createElement('p');
    status.textContent = t('nowplaying.metadataWaiting');
    nodes.push(status);
  }
  destination.replaceChildren(...nodes);
}

function trapNowPlayingFocus(event) {
  const panel = byId('er-nowplaying');
  if (event.key !== 'Tab' || !panel?.classList.contains('is-open')) return;
  if (panel.getAttribute('aria-modal') !== 'true') return;
  const focusable = [...panel.querySelectorAll(FOCUSABLE)].filter(element => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ------------------------------------------------------------------ *
 * Action routing
 * ------------------------------------------------------------------ */

function bindActions() {
  // Capture before the recovered runtime's target handlers. Some runtime
  // controls stop bubbling, while this presentation layer still needs to
  // route the additive shell controls consistently.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const searchResult = target.closest('#search-results .search-result-item:not(.search-result-item--empty)');
    if (searchResult && loadUiState().destination === 'search') {
      markActivatedSearchResult(searchResult);
      // Let the recovered result handler use its stable filtered-result index.
      // Reconcile the presentation destination after the recovered handler has
      // consumed the click so mobile never lands on a blank Search workspace.
      queueMicrotask(() => {
        setDestination('listen', true);
      });
      return;
    }
    const dest = target.closest('button[data-er-dest]');
    if (dest) {
      event.preventDefault();
      const destination = dest.getAttribute('data-er-dest');
      if (document.documentElement.classList.contains('er-nowplaying-open')) {
        if (parseNowPlayingHistory(history.state)) {
          pendingNowPlayingDestination = destination;
          history.back();
          return;
        }
        closeNowPlaying();
      }
      setDestination(destination, true);
      return;
    }

    const saved = target.closest('button[data-er-saved]');
    if (saved) {
      event.preventDefault();
      const segment = saved.getAttribute('data-er-saved');
      saveUiState({ destination: 'saved', savedSegment: segment });
      applySavedSegment(segment);
      applyViewport(loadUiState());
      return;
    }

    if (target.closest('[data-er-open-search]')) {
      if (classifyViewport() === 'mobile') {
        setDestination('search', true);
      } else {
        // Desktop keeps the runtime's command palette and its Ctrl/Cmd+K path. One
        // event only (both modifiers would open it twice), and focus after the
        // runtime's own requestAnimationFrame focus of the hidden engine input.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        requestAnimationFrame(() => requestAnimationFrame(() => byId('er-station-query')?.focus()));
      }
      return;
    }

    if (target.closest('[data-er-overflow]')) {
      const sheet = byId('er-overflow');
      setOverflowOpen(Boolean(sheet?.hidden), target.closest('[data-er-overflow]'));
      return;
    }

    const proxy = target.closest('[data-click-id]');
    if (proxy) {
      const targetId = proxy.getAttribute('data-click-id');
      clickExisting(targetId);
      if (proxy.closest('#er-overflow')) {
        const transfersFocus = targetId === 'settings-toggle' || targetId === 'filters-toggle';
        setOverflowOpen(false, null, !transfersFocus);
        if (transfersFocus) focusProxySurface(targetId);
      }
      queueMicrotask(syncNowPlaying);
      return;
    }

    const sleep = target.closest('[data-er-sleep-min]');
    if (sleep) {
      const minutes = sleep.getAttribute('data-er-sleep-min');
      document.querySelector(`#sleep-menu [data-min="${CSS.escape(minutes)}"]`)?.click();
      return;
    }

    const collapse = target.closest('[data-er-collapse]');
    if (collapse) {
      const wanted = collapse.getAttribute('data-er-collapse');
      const state = loadUiState();
      const next = saveUiState({ collapsed: nextCollapse(state.collapsed, wanted) });
      applyViewport(next);
      // The invoking Hide control disappears with its panel: move focus to the
      // Restore control that replaced it, or back to the separator.
      const restore = byId('er-restore-panel');
      if (next.collapsed && restore && !restore.hidden) queueMicrotask(() => restore.focus());
      else queueMicrotask(() => byId('er-separator')?.focus());
      invalidateMap(true);
      return;
    }

    if (target.closest('#er-open-nowplaying')) {
      openNowPlaying(target.closest('button'));
      return;
    }

    if (target.closest('#er-nowplaying-dismiss')) {
      if (parseNowPlayingHistory(history.state)) history.back();
      else closeNowPlaying();
      return;
    }

    if (!target.closest('#er-overflow') && !byId('er-overflow')?.hidden) setOverflowOpen(false);
  }, true);

  byId('settings-save')?.addEventListener('click', () => {
    const select = byId('setting-locale');
    saveLocalePreview(select?.value);
  }, true);

  window.addEventListener('popstate', event => {
    if (!parseNowPlayingHistory(event.state) && document.documentElement.classList.contains('er-nowplaying-open')) {
      closeNowPlaying();
    }
    if (!parseNowPlayingHistory(event.state) && pendingNowPlayingDestination) {
      const destination = pendingNowPlayingDestination;
      pendingNowPlayingDestination = null;
      setDestination(destination, true);
      return;
    }
    const dest = parseDestination(location.hash);
    if (dest && dest !== loadUiState().destination) setDestination(dest, false);
  });

  window.addEventListener('hashchange', () => {
    const dest = parseDestination(location.hash);
    if (dest && dest !== loadUiState().destination) setDestination(dest, false);
  });

  // The persisted split percentage was clamped against the workspace width it was
  // saved at; after a resize it must be re-clamped against the width the window has
  // NOW — without persisting the transient viewport — or a wide saved split can pin
  // the list or map below its documented pixel minimums in a narrowed window.
  const applyViewportReClamped = () => {
    const state = loadUiState();
    applyViewport({ ...state, split: clampSplitPercent(state.split, workspaceWidth()) });
  };
  let resizeFrame = 0;
  const onResize = () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      applyViewportReClamped();
    });
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => {
    onResize();
    // iOS reports stale metrics immediately after rotation.
    setTimeout(() => {
      applyViewportReClamped();
      invalidateMap(true);
    }, 250);
  });
  window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', onResize);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const settings = byId('settings-modal');
      if (settingsModalIsVisible(settings)) {
        event.preventDefault();
        dismissLocalePreview();
        settings.hidden = true;
        settings.style.display = 'none';
        settings.setAttribute('aria-hidden', 'true');
        return;
      }
      if (!byId('er-overflow')?.hidden) {
        setOverflowOpen(false);
        return;
      }
      if (document.documentElement.classList.contains('er-nowplaying-open')) {
        if (parseNowPlayingHistory(history.state)) history.back();
        else closeNowPlaying();
      }
      return;
    }
    trapNowPlayingFocus(event);
  });

  const audio = byId('audio-player');
  for (const type of ['play', 'pause', 'loadstart', 'error', 'emptied']) {
    audio?.addEventListener(type, () => {
      if (document.documentElement.classList.contains('er-nowplaying-open')) syncNowPlaying();
    });
  }
}

/* ------------------------------------------------------------------ *
 * Desktop separator
 * ------------------------------------------------------------------ */

function bindSeparator() {
  const separator = byId('er-separator');
  if (!separator) return;

  const applyValue = (value, flush = false) => {
    const split = clampSplitPercent(value, workspaceWidth());
    applyViewport(saveUiState({ split }));
    invalidateMap(flush);
  };

  separator.addEventListener('keydown', event => {
    const current = loadUiState().split;
    const step = event.shiftKey ? 8 : 2;
    const bounds = splitBounds(workspaceWidth());
    const handled = {
      ArrowLeft: () => applyValue(current - step, true),
      ArrowRight: () => applyValue(current + step, true),
      ArrowUp: () => applyValue(current - step, true),
      ArrowDown: () => applyValue(current + step, true),
      Home: () => applyValue(bounds.min, true),
      End: () => applyValue(bounds.max, true),
      Enter: () => applyValue(DEFAULT_SPLIT, true),
      ' ': () => applyValue(DEFAULT_SPLIT, true)
    }[event.key];
    if (!handled) return;
    event.preventDefault();
    handled();
  });

  separator.addEventListener('dblclick', () => applyValue(DEFAULT_SPLIT, true));

  let dragging = false;
  separator.addEventListener('pointerdown', event => {
    dragging = true;
    document.documentElement.classList.add('er-resizing');
    separator.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  separator.addEventListener('pointermove', event => {
    if (!dragging) return;
    const main = document.querySelector('main.main');
    if (!main) return;
    const rect = main.getBoundingClientRect();
    const offset = document.documentElement.dir === 'rtl'
      ? rect.right - event.clientX
      : event.clientX - rect.left;
    // Throttled to one frame while dragging.
    applyValue((offset / rect.width) * 100, false);
  });
  const endDrag = event => {
    if (!dragging) return;
    dragging = false;
    document.documentElement.classList.remove('er-resizing');
    if (event?.pointerId !== undefined && separator.hasPointerCapture?.(event.pointerId)) {
      separator.releasePointerCapture(event.pointerId);
    }
    // One unthrottled invalidation once the resize ends.
    invalidateMap(true);
    syncVirtualRows();
  };
  separator.addEventListener('pointerup', endDrag);
  separator.addEventListener('pointercancel', endDrag);
}

/* ------------------------------------------------------------------ *
 * Runtime observation (narrowly scoped)
 * ------------------------------------------------------------------ */

function observeRuntime() {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const locale = effectiveLocale();
      applyDeclarativeI18n(document, locale);
      localizeRuntime(locale);
      if (document.documentElement.classList.contains('er-nowplaying-open')) syncNowPlaying();
    });
  };

  const observer = new MutationObserver(schedule);
  const watched = [
    ...RUNTIME_TEXT_SCOPES.map(scope => scope.id),
    'player-station',
    'player-meta',
    'player-track',
    'nowcard-title',
    'nowcard-artist',
    'nowcard-art',
    'nowcard',
    'btn-play',
    'btn-favorite'
  ];
  for (const id of new Set(watched)) {
    const node = byId(id);
    if (node) observer.observe(node, { childList: true, characterData: true, attributes: true, subtree: true });
  }

  const grid = byId('station-grid');
  if (grid) {
    let gridFrame = 0;
    new MutationObserver(() => {
      if (gridFrame) return;
      gridFrame = requestAnimationFrame(() => {
        gridFrame = 0;
        syncVirtualRows();
      });
    }).observe(grid, { childList: true, subtree: true });
  }

  if (typeof ResizeObserver === 'function') {
    const resizeObserver = new ResizeObserver(() => syncChromeMetrics());
    for (const element of [document.querySelector('header.header'), document.querySelector('.er-mobile-nav')]) {
      if (element) resizeObserver.observe(element);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Startup
 * ------------------------------------------------------------------ */

function start() {
  document.documentElement.classList.add('er-root');
  bindLocaleOptions();
  bindSearchIme();
  bindCountrySearch();

  const hashDest = parseDestination(location.hash);
  const loaded = loadUiState();
  const state = saveUiState({
    ...loaded,
    destination: hashDest || loaded.destination,
    locale: readLocale(loaded),
    localeExplicit: loaded.localeExplicit
  });

  restoreStoredTheme();
  applyLocale(state.locale);
  guardDocumentLocale();
  applyViewport(loadUiState());
  bindActions();
  bindSeparator();
  observeRuntime();
  // A settled directory load (boot, manual refresh, or country expansion) replaces
  // the runtime's stations.v3 record; the search filter validates tag/language
  // matches against that snapshot, so it must be re-read or newly loaded stations
  // stay hidden from an already-typed query until the listener edits it.
  window.addEventListener('earthradio:stations-load-settled', () => {
    runtimeSearchStations = null;
    runtimeSearchStationsPromise = null;
    void readRuntimeSearchStations().then(() => applySearchScope());
  });
  document.documentElement.dataset.erUiReady = 'true';

  // The recovered runtime renders its first catalog asynchronously.
  window.addEventListener('load', () => {
    applyViewport(loadUiState());
    localizeRuntime(effectiveLocale());
    invalidateMap(true);
  }, { once: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
