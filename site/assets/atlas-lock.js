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

function bindAtlasLock() {
  const you = document.getElementById('er-you');
  you?.addEventListener('click', event => {
    const chip = event.target instanceof Element ? event.target.closest('[data-er-palette]') : null;
    if (!chip || !you.contains(chip)) return;
    event.preventDefault();
    const palette = chip.getAttribute('data-er-palette') === 'paper' ? 'paper' : 'night';
    applyAtlasChrome(saveUiState({ palette }));
  });
  document.getElementById('er-glass-log')?.addEventListener('change', event => {
    const checked = event.target instanceof HTMLInputElement && event.target.checked;
    applyAtlasChrome(saveUiState({ glassLog: checked }));
  });
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
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
