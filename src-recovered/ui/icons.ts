// Inline monochrome SVG icons. Using SVG (not Unicode glyphs) avoids platform emoji
// rendering (e.g. Windows drawing media symbols as blue emoji) and keeps everything
// theme-aware via `currentColor`.

export type IconName =
  | 'play'
  | 'pause'
  | 'prev'
  | 'next'
  | 'heart'
  | 'moon'
  | 'similar'
  | 'theme'
  | 'settings'
  | 'globe';

const PATHS: Record<IconName, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  prev: 'M7 6h2v12H7zM18 6l-8 6 8 6z',
  next: 'M15 6h2v12h-2zM6 6l8 6-8 6z',
  heart: 'M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z',
  moon: 'M12.74 2.02a9 9 0 1 0 9.24 9.24 7 7 0 0 1-9.24-9.24z',
  similar: 'M9 4a5.5 5.5 0 1 0 0 11A5.5 5.5 0 0 0 9 4zm0 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm6.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
  theme: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2v16a8 8 0 0 0 0-16z',
  settings: 'M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.74 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.42.34.68.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.05.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.26.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2c1.7 0 3.3.6 4.6 1.5-.5.9-1.3 1.6-2.3 2-.6-1-1.4-2-2.3-2.9V4zm-2 .3v3.2c-1 .2-2 .5-2.9.9A8 8 0 0 1 10 4.3zM6 12a8 8 0 0 1 .3-2.1c1 .5 2.1.8 3.2 1V12c0 1 .1 2 .3 3-1.1.2-2.2.5-3.2 1A8 8 0 0 1 6 12zm4 7.7a8 8 0 0 1-2.9-2.3c.9-.4 1.9-.7 2.9-.9v3.2zm2 .3v-3.2c.9.9 1.7 1.9 2.3 2.9-.7.2-1.5.3-2.3.3zm0-5.2V12c1.1-.2 2.2-.5 3.2-1 .2.6.3 1.3.3 2s-.1 1.4-.3 2c-1-.5-2.1-.8-3.2-1z'
};

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '1em');
  svg.setAttribute('height', '1em');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATHS[name]);
  svg.appendChild(path);
  return svg;
}
