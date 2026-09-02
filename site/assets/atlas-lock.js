/*
 * Atlas lock: Night/Paper, glass on the log, You destination chrome.
 * Additive. Does not rewrite the hashed runtime.
 */

import { loadUiState, saveUiState } from './responsive-ui.js';

export function applyAtlasChrome(state = loadUiState()) {
  const root = document.documentElement;
  const palette = state.palette === 'paper' ? 'paper' : 'night';
  root.dataset.erPalette = palette;
  const theme = palette === 'paper' ? 'light' : 'dark';
  root.dataset.theme = theme;
  // The runtime also writes an inline color-scheme from its own preference; that value
  // outranks the stylesheet for native controls, so the palette has to claim it too.
  if (root.style.colorScheme !== theme) root.style.colorScheme = theme;
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

// True only while we are driving the runtime's theme button ourselves. The
// `#theme-toggle` listener below flips the palette for *user* presses; it must stay
// out of the way when the palette we are moving to is already known.
let drivingRuntimeTheme = false;

/*
 * Press the runtime's own theme button and report the theme it landed on.
 *
 * The recovered runtime builds its CARTO tile layer once at map creation and rebuilds
 * it in exactly one place: its `#theme-toggle` handler, which reads
 * `documentElement.dataset.theme` synchronously right after flipping it. Pressing that
 * button is therefore the only additive way to move the basemap. Reading the attribute
 * straight back is safe because nothing has yielded since: the rebuild happened inside
 * the dispatch, and responsive-ui's MutationObserver revert is still queued.
 */
function pressRuntimeToggle() {
  const runtimeToggle = document.getElementById('theme-toggle');
  if (!runtimeToggle) return null;
  drivingRuntimeTheme = true;
  try { runtimeToggle.click(); } finally { drivingRuntimeTheme = false; }
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/*
 * Bring the basemap to `palette`, given the theme the runtime last built tiles for.
 *
 * The runtime flips its own stored preference, which is resolved against the OS
 * `prefers-color-scheme` and can therefore disagree with our palette. One more press
 * settles it: with only two themes, flipping away from the wrong one lands on the
 * right one, leaving the tiles and the runtime preference both on `palette`.
 */
function alignRuntimeTiles(palette, landed) {
  if (landed === null) return;
  if (landed === (palette === 'paper' ? 'light' : 'dark')) return;
  pressRuntimeToggle();
}

function selectPalette(palette) {
  const state = saveUiState({ palette });
  alignRuntimeTiles(palette, pressRuntimeToggle());
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
      // This listener is bound from DOMContentLoaded; the runtime binds its own only
      // after awaiting storage hydration, so by now it has flipped `data-theme` and
      // rebuilt its tiles, and this microtask was queued ahead of the MutationObserver
      // that reverts the attribute. The value read here is the theme the runtime chose
      // from its own preference, which the palette flip above does not consult.
      const landed = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      alignRuntimeTiles(next, landed);
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
