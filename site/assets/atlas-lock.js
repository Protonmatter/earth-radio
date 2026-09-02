/*
 * Atlas lock: Night/Paper, glass on the log, You destination chrome.
 * Additive. Does not rewrite the hashed runtime.
 */

import { loadUiState, saveUiState } from './responsive-ui.js';

export function applyAtlasChrome(state = loadUiState()) {
  const root = document.documentElement;
  const palette = state.palette === 'paper' ? 'paper' : 'night';
  root.dataset.erPalette = palette;
  root.dataset.theme = palette === 'paper' ? 'light' : 'dark';
  root.classList.toggle('er-glass-log', state.glassLog === true);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = palette === 'paper' ? '#f4efe4' : '#12110e';
  for (const button of document.querySelectorAll('#er-you [data-er-palette]')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-er-palette') === palette));
  }
  const glass = document.getElementById('er-glass-log');
  if (glass) glass.checked = state.glassLog === true;
  return state;
}

// True only while `selectPalette()` is driving the recovered runtime's own theme
// button. The `#theme-toggle` listener below flips the palette for *user* presses;
// it must stay out of the way when the palette is already known.
let drivingRuntimeTheme = false;

/*
 * Move to `palette` and take the Leaflet basemap along.
 *
 * The recovered runtime builds its CARTO tile layer once at map creation and
 * rebuilds it in exactly one place: its `#theme-toggle` handler, which reads
 * `documentElement.dataset.theme` synchronously right after flipping it. Writing
 * the attribute here would leave a dark basemap under Paper chrome, so the palette
 * chips press that button instead. The runtime toggles its own stored preference,
 * which can drift from ours, so press again when the first press lands on the wrong
 * theme; the second press runs before any microtask and re-reads the corrected
 * attribute, leaving both the tiles and the runtime preference on `palette`.
 */
function selectPalette(palette) {
  const state = saveUiState({ palette });
  const wantedTheme = palette === 'paper' ? 'light' : 'dark';
  const runtimeToggle = document.getElementById('theme-toggle');
  if (runtimeToggle) {
    drivingRuntimeTheme = true;
    try {
      runtimeToggle.click();
      if (document.documentElement.dataset.theme !== wantedTheme) runtimeToggle.click();
    } finally {
      drivingRuntimeTheme = false;
    }
  }
  return applyAtlasChrome(state);
}

function bindAtlasLock() {
  const you = document.getElementById('er-you');
  you?.addEventListener('click', event => {
    const chip = event.target instanceof Element ? event.target.closest('[data-er-palette]') : null;
    if (!chip || !you.contains(chip)) return;
    event.preventDefault();
    const palette = chip.getAttribute('data-er-palette') === 'paper' ? 'paper' : 'night';
    if (palette === (loadUiState().palette === 'paper' ? 'paper' : 'night')) {
      applyAtlasChrome(loadUiState());
      return;
    }
    selectPalette(palette);
  });
  document.getElementById('er-glass-log')?.addEventListener('change', event => {
    const checked = event.target instanceof HTMLInputElement && event.target.checked;
    applyAtlasChrome(saveUiState({ glassLog: checked }));
  });
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    if (drivingRuntimeTheme) return;
    queueMicrotask(() => {
      const next = loadUiState().palette === 'paper' ? 'night' : 'paper';
      applyAtlasChrome(saveUiState({ palette: next }));
    });
  });
}

function start() {
  applyAtlasChrome();
  bindAtlasLock();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
