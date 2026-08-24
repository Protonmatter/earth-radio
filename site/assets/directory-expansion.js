// Earth Radio directory expansion v1.0.0
// The initial directory load is deliberately bounded (global top-click plus a handful of
// featured countries) so boot stays fast. This overlay expands coverage on demand: when a
// listener focuses a country (map popup "Explore", the country picker, or the country
// filter), its ISO code joins RADIO_CONFIG.featuredCountryCodes and a directory refresh
// pulls that country's top stations. Expansions persist across sessions. Loaded before
// the runtime bundle so persisted expansions apply to the very first fetch.

const EXPANDED_KEY = 'earth-radio-expanded-countries-v1';
const COUNTRY_INDEX_KEY = 'earth-radio-country-index-v1';
const COUNTRY_INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// The desktop proxy accepts at most 20 country codes; keep headroom for the defaults.
const MAX_TOTAL_COUNTRY_CODES = 20;
const COUNTRY_LIST_BASES = [
  'https://all.api.radio-browser.info',
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info'
];

const expansion = { busy: false, lastCountry: '', indexPromise: null };

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

async function loadCountryIndex() {
  try {
    const cached = JSON.parse(localStorage.getItem(COUNTRY_INDEX_KEY) || 'null');
    if (cached && Array.isArray(cached.list) && Date.now() - Number(cached.savedAt || 0) < COUNTRY_INDEX_TTL_MS) {
      return cached.list;
    }
  } catch { /* refetch below */ }

  for (const base of COUNTRY_LIST_BASES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`${base}/json/countries`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      clearTimeout(timer);
      if (!response.ok) continue;
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
    } catch { /* try the next mirror */ }
  }
  return [];
}

function countryIndex() {
  if (!expansion.indexPromise) expansion.indexPromise = loadCountryIndex();
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
  if (expansion.busy && expansion.lastCountry === name) return { expanded: false, reason: 'in progress' };

  const index = await countryIndex();
  const entry = index.find(item => item.name.toLowerCase() === name.toLowerCase());
  if (!entry) return { expanded: false, reason: 'country not in directory index' };

  const codes = currentCodes();
  if (codes.includes(entry.code)) return { expanded: false, reason: 'already covered', code: entry.code };
  if (codes.length >= MAX_TOTAL_COUNTRY_CODES) {
    // Drop the oldest persisted expansion (never a built-in default) to make room.
    const persisted = readPersistedCodes();
    const removable = persisted.find(code => codes.includes(code));
    if (!removable) return { expanded: false, reason: 'country expansion limit reached' };
    codes.splice(codes.indexOf(removable), 1);
    persistCodes(persisted.filter(code => code !== removable));
  }

  expansion.busy = true;
  expansion.lastCountry = name;
  try {
    const merged = [...codes, entry.code];
    applyCodes(merged);
    persistCodes([...new Set([...readPersistedCodes(), entry.code])]);
    toast(`Loading ${entry.stationcount ? `${entry.stationcount.toLocaleString()} ` : ''}stations for ${entry.name}…`);
    document.getElementById('refresh-stations')?.click();
    return { expanded: true, code: entry.code, stationcount: entry.stationcount };
  } finally {
    setTimeout(() => { expansion.busy = false; }, 4000);
  }
}

function countryFromEventTarget(target) {
  const explore = target?.closest?.('.popup-country-btn');
  if (explore) return explore.dataset.country || '';
  const option = target?.closest?.('#er-country-options [role="option"]');
  if (option) return option.dataset.country || '';
  return '';
}

function wireSelectionListeners() {
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

applyPersistedExpansions();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireSelectionListeners);
else wireSelectionListeners();

// Debug/e2e hook.
window.earthRadioDirectory = Object.freeze({
  version: '1.0.0',
  expand: expandCountry,
  expandedCodes: readPersistedCodes,
  activeCodes: currentCodes
});
