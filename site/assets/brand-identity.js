/* Brand presentation only: the existing player retains all playback control. */
export function initBrandIdentity(doc = globalThis.document, environment = globalThis) {
  if (!doc) return;

  const brands = [...(doc.querySelectorAll?.('.earth-radio-brand') || [])];
  const audio = doc.getElementById?.('audio-player');
  const setPlaying = playing => {
    for (const brand of brands) brand.classList?.toggle('is-playing', playing);
  };

  // A module loaded after playback starts can catch up without calling play().
  // paused=false alone also occurs while loading or buffering.
  setPlaying(Boolean(audio && audio.paused === false && audio.readyState >= 3 &&
    !audio.ended && !audio.seeking && !audio.error));
  audio?.addEventListener?.('playing', () => setPlaying(true));
  for (const event of ['pause', 'waiting', 'ended', 'emptied', 'error', 'loadstart', 'seeking']) {
    audio?.addEventListener?.(event, () => setPlaying(false));
  }
  // `stalled` describes the network. Already-buffered audio can still play;
  // `waiting` is the signal to stop motion when that buffer is exhausted.

  const icons = [...(doc.querySelectorAll?.('link[data-earth-radio-icon]') || [])];
  let colorScheme;
  try {
    colorScheme = environment.matchMedia?.('(prefers-color-scheme: dark)');
  } catch {
    // Restricted/older webviews retain the static pine icons declared in HTML.
  }
  const updateIcons = () => {
    const palette = colorScheme?.matches === true ? 'dark' : 'light';
    for (const icon of icons) {
      const href = icon.dataset?.[palette];
      if (href) icon.setAttribute('href', href);
    }
  };
  updateIcons();
  if (typeof colorScheme?.addEventListener === 'function') {
    colorScheme.addEventListener('change', updateIcons);
  } else if (typeof colorScheme?.addListener === 'function') {
    colorScheme.addListener(updateIcons);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initBrandIdentity(), { once: true });
  } else {
    initBrandIdentity();
  }
}
