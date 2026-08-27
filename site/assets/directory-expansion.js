// Earth Radio directory expansion v1.0.0
// The initial directory load is deliberately bounded (global top-click plus a handful of
// featured countries) so boot stays fast. This overlay expands coverage on demand: when a
// listener focuses a country (map popup "Explore", the country picker, or the country
// filter), its ISO code joins RADIO_CONFIG.featuredCountryCodes and a directory refresh
// pulls that country's top stations. Expansions persist across sessions. Loaded before
// the runtime bundle so persisted expansions apply to the very first fetch.

const EXPANDED_KEY = 'earth-radio-expanded-countries-v1';
const UNVERIFIED_KEY = 'earth-radio-expanded-unverified-v1';
const COUNTRY_INDEX_KEY = 'earth-radio-country-index-v1';
const COUNTRY_INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// The desktop proxy accepts at most 20 country codes; keep headroom for the defaults.
const MAX_TOTAL_COUNTRY_CODES = 20;
const COUNTRY_LIST_BASES = [
  'https://all.api.radio-browser.info',
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info'
];

// One serialized/coalescing refresh scheduler: new ISO codes join the config
// immediately, and each refresh snapshots the latest persisted set just before it
// runs, so a stale earlier completion can never be the terminal state. Each cycle
// normally awaits the runtime-owned correlated drain promise. The legacy
// earthradio:stations-load-settled event remains only as a compatibility fallback for
// an older installed runtime that does not expose earthRadioRuntime.refreshStations.
// unverified: country codes that were applied to the config but whose stations never
// actually arrived (the forced refresh failed, or fell back to the pre-expansion
// cache). Re-selecting such a country retries the load instead of no-opping.
const expansion = { indexPromise: null, refreshPromise: null, queued: false, unverified: new Set() };

function radioConfig() {
  if (!window.RADIO_CONFIG || typeof window.RADIO_CONFIG !== 'object') window.RADIO_CONFIG = {};
  return window.RADIO_CONFIG;
}

function readPersistedCodes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(code => /^[A-Z]{2}$/.test(String(code))) : [];
  } catch {
    return [];
  }
}

function persistCodes(codes) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(codes));
  } catch { /* persistence is best-effort */ }
}

function readUnverifiedCodes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(UNVERIFIED_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(code => /^[A-Z]{2}$/.test(String(code))) : [];
  } catch {
    return [];
  }
}

function persistUnverified() {
  try {
    localStorage.setItem(UNVERIFIED_KEY, JSON.stringify([...expansion.unverified]));
  } catch { /* persistence is best-effort */ }
}

function restoreUnverified() {
  for (const code of readUnverifiedCodes()) expansion.unverified.add(code);
}

function currentCodes() {
  const config = radioConfig();
  const list = Array.isArray(config.featuredCountryCodes) ? config.featuredCountryCodes : [];
  return list.map(code => String(code || '').trim().toUpperCase()).filter(code => /^[A-Z]{2}$/.test(code));
}

function applyCodes(codes) {
  radioConfig().featuredCountryCodes = codes;
}

// Applied at module evaluation, before the runtime bundle's first directory fetch.
function applyPersistedExpansions() {
  const persisted = readPersistedCodes();
  if (!persisted.length) return;
  const merged = [...new Set([...currentCodes(), ...persisted])].slice(0, MAX_TOTAL_COUNTRY_CODES);
  applyCodes(merged);
}

// Exported (with injectable fetch/timeout) for direct unit testing of the mirror
// walk, the abort budget, and empty-result semantics.
export async function loadCountryIndex({ fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  try {
    const cached = JSON.parse(localStorage.getItem(COUNTRY_INDEX_KEY) || 'null');
    if (cached && Array.isArray(cached.list) && Date.now() - Number(cached.savedAt || 0) < COUNTRY_INDEX_TTL_MS) {
      return cached.list;
    }
  } catch { /* refetch below */ }

  for (const base of COUNTRY_LIST_BASES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}/json/countries`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      // The abort timer must survive until the body is parsed: a mirror that sends
      // headers and then stalls the JSON would otherwise hang this attempt forever.
      const raw = await response.json();
      if (!Array.isArray(raw)) continue;
      const list = raw
        .map(entry => ({
          name: String(entry?.name || '').trim(),
          code: String(entry?.iso_3166_1 || '').trim().toUpperCase(),
          stationcount: Number(entry?.stationcount) || 0
        }))
        .filter(entry => entry.name && /^[A-Z]{2}$/.test(entry.code));
      if (!list.length) continue;
      try {
        localStorage.setItem(COUNTRY_INDEX_KEY, JSON.stringify({ savedAt: Date.now(), list }));
      } catch { /* cache is best-effort */ }
      return list;
    } catch { /* try the next mirror */ } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

function countryIndex() {
  if (!expansion.indexPromise) {
    expansion.indexPromise = loadCountryIndex().then(list => {
      // An empty result (offline boot, all mirrors down) must not be memoized
      // forever — drop it so the next country selection retries the mirrors.
      if (!list.length) expansion.indexPromise = null;
      return list;
    });
  }
  return expansion.indexPromise;
}

function toast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('toast--visible')));
  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 400);
  }, 3200);
}

async function expandCountry(countryName) {
  const name = String(countryName || '').trim();
  if (!name || name === 'Unknown') return { expanded: false, reason: 'no country' };

  const index = await countryIndex();
  // Selections arrive as full names (map popups, picker) or bare ISO codes (typed
  // search accepts either); every index record carries both.
  const needle = name.toLowerCase();
  const entry = index.find(item => item.name.toLowerCase() === needle || item.code.toLowerCase() === needle);
  if (!entry) return { expanded: false, reason: 'country not in directory index' };

  const codes = currentCodes();
  if (codes.includes(entry.code)) {
    // In-memory unverified is empty after reload; persisted unverified (and the
    // stations.v3 catalog, when readable) are the source of truth across boots.
    if (expansion.unverified.has(entry.code) || await countryCoverageMissing(entry.code)) {
      expansion.unverified.add(entry.code);
      persistUnverified();
      scheduleRefresh();
      return { expanded: false, reason: 'retrying incomplete load', code: entry.code };
    }
    return { expanded: false, reason: 'already covered', code: entry.code };
  }
  if (codes.length >= MAX_TOTAL_COUNTRY_CODES) {
    // Drop the oldest persisted expansion (never a built-in default) to make room.
    const persisted = readPersistedCodes();
    const removable = persisted.find(code => codes.includes(code));
    if (!removable) return { expanded: false, reason: 'country expansion limit reached' };
    codes.splice(codes.indexOf(removable), 1);
    persistCodes(persisted.filter(code => code !== removable));
  }

  applyCodes([...codes, entry.code]);
  persistCodes([...new Set([...readPersistedCodes(), entry.code])]);
  toast(`Loading ${entry.stationcount ? `${entry.stationcount.toLocaleString()} ` : ''}stations for ${entry.name}…`);
  scheduleRefresh();
  return { expanded: true, code: entry.code, stationcount: entry.stationcount };
}

function runRuntimeRefresh() {
  const refreshStations = window.earthRadioRuntime?.refreshStations;
  if (typeof refreshStations === 'function') {
    // The installed runtime owns directory-load serialization and returns the drain
    // promise for this request. Awaiting that promise correlates completion even when
    // boot, manual, retry, or cloned refresh actions were already in flight.
    return Promise.resolve(refreshStations.call(window.earthRadioRuntime));
  }
  return new Promise(resolve => {
    const button = document.getElementById('refresh-stations');
    if (!button) {
      resolve({ ok: false });
      return;
    }
    const settle = event => {
      window.removeEventListener('earthradio:stations-load-settled', settle);
      resolve(event?.detail || { ok: false });
    };
    window.addEventListener('earthradio:stations-load-settled', settle);
    button.click();
  });
}

// Serializes directory refreshes. While one runs, further expansions only mark the
// scheduler dirty; the follow-up refresh re-reads the merged code set, so the last
// refresh always covers every selected country.
function scheduleRefresh() {
  expansion.queued = true;
  if (expansion.refreshPromise) return expansion.refreshPromise;

  const run = async () => {
    while (expansion.queued) {
      expansion.queued = false;
      const codes = [...new Set([...currentCodes(), ...readPersistedCodes()])].slice(0, MAX_TOTAL_COUNTRY_CODES);
      applyCodes(codes);
      const outcome = await runRuntimeRefresh();
      await recordCoverage(codes, outcome);
    }
  };
  const refreshPromise = run().finally(() => {
    if (expansion.refreshPromise === refreshPromise) expansion.refreshPromise = null;
    if (expansion.queued) scheduleRefresh();
  });
  expansion.refreshPromise = refreshPromise;
  return refreshPromise;
}

// A refresh that "settled" is not proof the selected countries actually loaded: a
// failed forced load falls back to the pre-expansion cache with ok=true. Verify
// coverage against the catalog the runtime actually persisted; codes with no
// stations stay retryable via re-selection.
async function recordCoverage(codes, outcome) {
  if (outcome && outcome.ok === false) {
    for (const code of codes) expansion.unverified.add(code);
    persistUnverified();
    return;
  }
  const loaded = await readCachedCountryCodes();
  for (const code of codes) {
    if (!loaded || loaded.has(code)) expansion.unverified.delete(code);
    else expansion.unverified.add(code);
  }
  persistUnverified();
}

async function countryCoverageMissing(code) {
  const loaded = await readCachedCountryCodes();
  return Boolean(loaded) && !loaded.has(code);
}

// Reads the country codes present in the runtime's persisted stations.v3 catalog.
// Resolves null when the record is unreadable (no IndexedDB, schema drift) — the
// caller then treats the load as verified rather than retrying forever blind.
function readCachedCountryCodes() {
  return new Promise(resolve => {
    const idb = globalThis.indexedDB;
    if (!idb) return resolve(null);
    let request;
    try {
      request = idb.open('earthRadio', 1);
    } catch {
      return resolve(null);
    }
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
        resolve(stations
          ? new Set(stations.map(station => String(station?.countrycode || '').toUpperCase()).filter(Boolean))
          : null);
      };
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => database.close();
    };
  });
}

function countryFromEventTarget(target) {
  const explore = target?.closest?.('.popup-country-btn');
  return explore ? explore.dataset.country || '' : '';
}

function wireSelectionListeners() {
  // The country picker emits one semantic event for every selection path
  // (mouse click, Enter key, programmatic selection).
  document.addEventListener('earthradio:country-selected', event => {
    const country = event?.detail?.country;
    if (country) void expandCountry(country);
  });

  document.addEventListener('click', event => {
    const country = countryFromEventTarget(event.target);
    if (country) void expandCountry(country);
  }, true);

  // The classic filter sidebar uses checkbox inputs whose value is the country name.
  document.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.checked) return;
    if (!input.closest('#filter-countries')) return;
    if (input.value) void expandCountry(input.value);
  }, true);
}

// Browser-only bootstrap; guarded so the exported helpers stay importable from
// Node unit tests without a DOM.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  applyPersistedExpansions();
  restoreUnverified();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireSelectionListeners);
  else wireSelectionListeners();

  // Debug/e2e hook.
  window.earthRadioDirectory = Object.freeze({
    version: '1.0.0',
    expand: expandCountry,
    expandedCodes: readPersistedCodes,
    activeCodes: currentCodes
  });
}
