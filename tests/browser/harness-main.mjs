// Electron main process for the rendered browser regressions.
//
// This process is intentionally offline: a static server publishes the staged site over
// loopback and every https request is answered from tests/browser/fixtures. That keeps the
// recovered runtime's real catalog, filter, favorite, history, player, and Leaflet code paths
// running while the assertions stay deterministic.
//
// Usage: electron tests/browser/harness-main.mjs --out=<directory> [--only=<id,id>]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, screen, session } from 'electron';
import { fixtureStations } from './fixtures/stations.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { retryKnownCaptureError } from './harness.mjs';

const harnessDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(harnessDirectory, '..', '..');
const siteRoot = path.join(repositoryRoot, 'site');

const argument = name => {
  const prefix = `--${name}=`;
  const found = process.argv.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
};

const outputDirectory = path.resolve(argument('out') || path.join(repositoryRoot, 'evidence', 'responsive-ui'));
const harnessProfile = path.join(tmpdir(), `earth-radio-rendered-${process.pid}`);
app.setPath('userData', harnessProfile);
const onlyIds = argument('only').split(',').map(value => value.trim()).filter(Boolean);
const scenarios = onlyIds.length ? SCENARIOS.filter(item => onlyIds.includes(item.id)) : SCENARIOS;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const SEED_PAGE = '<!doctype html><meta charset="utf-8"><title>seed</title><body>seed</body>';
let observedStreamHosts = [];

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/__seed') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(SEED_PAGE);
      return;
    }
    // Rendered UI checks use a disposable, offline browser profile and test the
    // current working tree directly. Service-worker caching is covered by its
    // own unit tests and would otherwise mask local JavaScript edits.
    if (url.pathname === '/sw.js') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('disabled in rendered UI harness');
      return;
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const absolute = path.join(siteRoot, ...relative.split('/'));
    if (!absolute.startsWith(siteRoot)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(absolute);
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(absolute)] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

function installHttpsFixtures() {
  const stations = JSON.stringify(fixtureStations());
  session.defaultSession.protocol.handle('https', request => {
    const url = new URL(request.url);
    if (url.hostname.endsWith('api.radio-browser.info') && url.pathname.startsWith('/json/stations')) {
      return new Response(stations, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname.endsWith('.example.invalid')) observedStreamHosts.push(url.hostname);
    // Everything else (map tiles, station favicons, artwork, metadata providers) is offline
    // on purpose so failure handling is exercised instead of the network.
    return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } });
  });
}

const PROBE = `(() => {
  const rectOf = element => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return {
      x: Math.round(box.x * 100) / 100,
      y: Math.round(box.y * 100) / 100,
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
      top: Math.round(box.top * 100) / 100,
      left: Math.round(box.left * 100) / 100,
      right: Math.round(box.right * 100) / 100,
      bottom: Math.round(box.bottom * 100) / 100
    };
  };
  const isVisible = element => {
    if (!element) return false;
    if (element.hasAttribute('hidden')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0
      && box.bottom > 0 && box.right > 0
      && box.top < window.innerHeight && box.left < window.innerWidth;
  };
  const isActionable = element => {
    if (!isVisible(element)) return false;
    const box = element.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 1, Math.max(0, box.left + box.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, box.top + box.height / 2));
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === element || element.contains(hit) || hit.contains(element)));
  };
  const describe = element => element
    ? {
      rect: rectOf(element),
      visible: isVisible(element),
      actionable: isActionable(element),
      text: (element.textContent || '').trim().slice(0, 120),
      ariaCurrent: element.getAttribute('aria-current'),
      ariaPressed: element.getAttribute('aria-pressed'),
      ariaExpanded: element.getAttribute('aria-expanded'),
      ariaLabel: element.getAttribute('aria-label'),
      value: 'value' in element ? element.value : null,
      id: element.id || '',
      className: typeof element.className === 'string' ? element.className : ''
    }
    : null;
  const query = selector => describe(document.querySelector(selector));
  const queryAll = selector => [...document.querySelectorAll(selector)].map(describe);

  const style = getComputedStyle(document.body);
  const rootStyle = getComputedStyle(document.documentElement);
  const focused = document.activeElement;

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentElementClass: document.documentElement.className,
    theme: document.documentElement.dataset.theme || '',
    destination: document.documentElement.dataset.erDest || '',
    collapsed: document.documentElement.dataset.erCollapsed || '',
    savedSegment: document.documentElement.dataset.erSaved || '',
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    fontProfile: document.documentElement.dataset.fontProfile || '',
    bodyFontFamily: style.fontFamily,
    rowHeightVariable: rootStyle.getPropertyValue('--er-row-h').trim(),
    safeAreaVariables: {
      start: rootStyle.getPropertyValue('--er-safe-start').trim(),
      end: rootStyle.getPropertyValue('--er-safe-end').trim()
    },
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    stationCount: document.querySelectorAll('#station-grid .station-card').length,
    header: query('header.header'),
    headerContent: queryAll('header .logo, header button'),
    main: query('main.main'),
    list: query('#grid-panel'),
    map: query('#map-panel'),
    mapCanvas: query('#map'),
    attribution: query('.leaflet-control-attribution'),
    separator: query('#er-separator'),
    player: query('#player-bar'),
    playerPlay: query('#btn-play'),
    playerPrev: query('#btn-prev'),
    playerNext: query('#btn-next'),
    playerInfo: query('#er-open-nowplaying'),
    playerContent: queryAll('#player-bar button, #er-open-nowplaying'),
    nav: query('.er-mobile-nav'),
    navButtons: queryAll('.er-mobile-nav [data-er-dest]'),
    headerSearch: query('[data-er-open-search]'),
    headerOverflow: query('[data-er-overflow]'),
    headerButtons: queryAll('.header-right > button, .header-right > .kbd-hint'),
    overflowSheet: query('#er-overflow'),
    overflowItems: queryAll('#er-overflow button'),
    nowPlaying: query('#er-nowplaying'),
    nowPlayingDismiss: query('#er-nowplaying-dismiss'),
    nowPlayingTitle: query('#er-nowplaying-title'),
    nowPlayingPlay: query('#er-nowplaying [data-er-nowplaying-play]'),
    nowPlayingMetadata: query('#er-nowplaying-metadata'),
    nowPlayingSleepButtons: queryAll('#er-nowplaying [data-er-sleep-min]'),
    nowPlayingContent: queryAll('#er-nowplaying button, #er-nowplaying h2, #er-nowplaying-metadata'),
    searchPanel: query('#search-modal'),
    searchInput: query('#search-input'),
    stationQuery: query('#er-station-query'),
    countryQuery: query('#er-country-query'),
    countryOptions: queryAll('#er-country-options [role="option"]'),
    countrySummary: query('#er-country-summary'),
    searchResults: queryAll('#search-results .search-result-item'),
    visibleSearchResultNames: [...document.querySelectorAll('#search-results .search-result-item:not([hidden]) .search-result-item__name')]
      .map(node => (node.textContent || '').trim()),
    settledSearchNames: Array.isArray(window.__erSettledSearchNames) ? window.__erSettledSearchNames : null,
    activatedSearchName: (document.querySelector('#search-results [data-er-activated] .search-result-item__name')?.textContent || '').trim(),
    searchResultMetadata: [...document.querySelectorAll('#search-results .search-result-item:not([hidden]) .search-result-item__meta')]
      .map(node => (node.textContent || '').trim()),
    palette: {
      header: getComputedStyle(document.querySelector('header.header')).backgroundColor,
      body: style.backgroundColor,
      primary: getComputedStyle(document.querySelector('#btn-play')).backgroundColor,
      primaryVariable: getComputedStyle(document.querySelector('#btn-play')).getPropertyValue('--er-coral').trim(),
      primaryInline: document.querySelector('#btn-play').getAttribute('style') || '',
      map: getComputedStyle(document.querySelector('#map-panel')).backgroundColor
    },
    savedSegmentButtons: queryAll('[data-er-saved]'),
    collections: queryAll('#collections .collection-chip'),
    dashboard: query('#daily-dashboard'),
    dashboardActions: queryAll('#daily-dashboard [data-dashboard-action]'),
    settingsModal: query('#settings-modal'),
    filterSidebar: query('#filter-sidebar'),
    stationRows: [...document.querySelectorAll('#station-grid .station-card')].slice(0, 4).map(card => ({
      rect: rectOf(card),
      name: (card.querySelector('.station-card__name')?.textContent || '').trim(),
      meta: (card.querySelector('.station-card__meta')?.textContent || '').trim(),
      quality: (card.querySelector('.quality-pill')?.textContent || '').trim(),
      play: describe(card.querySelector('.station-card__play')),
      favorite: describe(card.querySelector('.station-card__favorite'))
    })),
    gridTitle: query('#grid-title'),
    gridCount: query('#grid-count'),
    gridSubtitle: query('#grid-subtitle'),
    listenIntro: query('#er-listen-intro'),
    skipLink: query('.er-skip'),
    collapseControls: queryAll('[data-er-collapse]'),
    activeElement: focused
      ? { id: focused.id || '', tag: focused.tagName, className: typeof focused.className === 'string' ? focused.className : '', label: focused.getAttribute('aria-label') || (focused.textContent || '').trim().slice(0, 60) }
      : null,
    separatorValues: (() => {
      const separator = document.getElementById('er-separator');
      if (!separator) return null;
      return {
        role: separator.getAttribute('role'),
        orientation: separator.getAttribute('aria-orientation'),
        min: separator.getAttribute('aria-valuemin'),
        max: separator.getAttribute('aria-valuemax'),
        now: separator.getAttribute('aria-valuenow'),
        tabIndex: separator.tabIndex,
        hidden: separator.hasAttribute('hidden')
      };
    })(),
    storedUiState: (() => {
      try { return JSON.parse(localStorage.getItem('earthRadio.ui.v1') || 'null'); } catch { return null; }
    })()
  };
})()`;

async function waitFor(contents, expression, { timeout = 20000, interval = 120 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let value = false;
    try {
      value = await contents.executeJavaScript(expression, true);
    } catch {
      value = false;
    }
    if (value) return true;
    if (Date.now() > deadline) return false;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

function seedScript(scenario) {
  const preferences = { theme: scenario.theme || 'light', locale: scenario.locale || 'en', volume: 0.8 };
  const favorites = {};
  for (const uuid of scenario.seed?.favorites ?? []) {
    favorites[uuid] = { stationuuid: uuid, addedAt: '2026-08-20T00:00:00.000Z' };
  }
  const stations = fixtureStations();
  const byUuid = new Map(stations.map(station => [station.stationuuid, station]));
  const recent = (scenario.seed?.recent ?? []).map(uuid => {
    const station = byUuid.get(uuid);
    return {
      stationuuid: uuid,
      name: station?.name || 'Unknown Station',
      country: station?.country || 'Unknown',
      countrycode: station?.countrycode || '',
      tags: station?.tags || '',
      codec: station?.codec || 'MP3',
      bitrate: station?.bitrate || 128,
      url_resolved: station?.url_resolved || '',
      favicon: '',
      secureStream: true,
      quality: { score: 84, label: 'strong', reasons: [] },
      playedAt: '2026-08-21T00:00:00.000Z'
    };
  });
  const uiState = {
    version: 1,
    destination: scenario.destination || 'listen',
    savedSegment: scenario.savedSegment || 'favorites',
    collapsed: null,
    split: 42,
    locale: scenario.locale || 'en'
  };
  return `(() => {
    localStorage.clear();
    localStorage.setItem('earthRadio.preferences.v1', ${JSON.stringify(JSON.stringify(preferences))});
    localStorage.setItem('earthRadio.favorites.v2', ${JSON.stringify(JSON.stringify(favorites))});
    localStorage.setItem('earthRadio.recent.v1', ${JSON.stringify(JSON.stringify(recent))});
    localStorage.setItem('earthRadio.ui.v1', ${JSON.stringify(JSON.stringify(uiState))});
    return true;
  })()`;
}

function safeAreaScript(scenario) {
  const inset = scenario.safeArea;
  if (!inset) return 'true';
  return `(() => {
    const style = document.createElement('style');
    style.id = 'er-test-safe-area';
    style.textContent = ':root{--er-safe-top:${inset.top}px;--er-safe-end:${inset.right}px;--er-safe-bottom:${inset.bottom}px;--er-safe-start:${inset.left}px;}';
    document.head.append(style);
    return true;
  })()`;
}

function standaloneScript(scenario) {
  if (!scenario.standalone) return 'true';
  return `(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => query.includes('display-mode: standalone')
      ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
      : original(query);
    return true;
  })()`;
}

async function sendKey(contents, action) {
  await contents.executeJavaScript(`(() => {
    const target = document.activeElement || document.body;
    const options = {
      key: ${JSON.stringify(action.key)},
      bubbles: true,
      cancelable: true,
      shiftKey: ${Boolean(action.shift)},
      ctrlKey: ${Boolean(action.control)},
      metaKey: ${Boolean(action.meta)}
    };
    target.dispatchEvent(new KeyboardEvent('keydown', options));
    target.dispatchEvent(new KeyboardEvent('keyup', options));
    return true;
  })()`, true);
  await new Promise(resolve => setTimeout(resolve, 120));
}

const ACTION_PROBE = `(() => ({
  destination: document.documentElement.dataset.erDest || '',
  collapsed: document.documentElement.dataset.erCollapsed || '',
  split: document.getElementById('er-separator')?.getAttribute('aria-valuenow') || '',
  overflowOpen: !document.getElementById('er-overflow')?.hidden,
  nowPlayingOpen: document.getElementById('er-nowplaying')?.classList.contains('is-open') || false,
  activeElement: document.activeElement?.id || '',
  trustedPointer: window.__erTrustedPointer || null
}))()`;

async function runAction(window_, action) {
  const contents = window_.webContents;
  if (action.type === 'wait') {
    await new Promise(resolve => setTimeout(resolve, action.ms ?? 100));
    return contents.executeJavaScript(ACTION_PROBE, true);
  }
  if (action.type === 'click') {
    await contents.executeJavaScript(`(() => {
      const node = document.querySelector(${JSON.stringify(action.selector)});
      if (!node) return false;
      node.click();
      return true;
    })()`, true);
    await new Promise(resolve => setTimeout(resolve, 150));
    return contents.executeJavaScript(ACTION_PROBE, true);
  }
  if (action.type === 'pointer') {
    const point = await contents.executeJavaScript(`(() => {
      const node = document.querySelector(${JSON.stringify(action.selector)});
      if (!node) return null;
      node.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      window.__erTrustedPointer = { expectedTarget: node.className, point: null, received: null };
      document.addEventListener('click', event => {
        window.__erTrustedPointer.received = {
          isTrusted: event.isTrusted,
          target: event.target instanceof Element ? event.target.className : '',
          x: event.clientX,
          y: event.clientY
        };
      }, { capture: true, once: true });
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`, true);
    if (point) {
      await contents.executeJavaScript(`window.__erTrustedPointer.point = ${JSON.stringify(point)}`, true);
      window_.focus();
      contents.focus();
      contents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
      contents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      contents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    }
    await new Promise(resolve => setTimeout(resolve, 200));
    return contents.executeJavaScript(ACTION_PROBE, true);
  }
  if (action.type === 'focus') {
    await contents.executeJavaScript(`(() => { const node = document.querySelector(${JSON.stringify(action.selector)}); if (!node) return false; node.focus(); return document.activeElement === node; })()`, true);
    return contents.executeJavaScript(ACTION_PROBE, true);
  }
  if (action.type === 'key') {
    await sendKey(contents, action);
    return contents.executeJavaScript(ACTION_PROBE, true);
  }
  if (action.type === 'ime') {
    // Korean and Chinese input arrives through composition events. Filtering must wait for
    // compositionend, so the harness reproduces the full composition sequence.
    await contents.executeJavaScript(`(() => {
      const node = document.querySelector(${JSON.stringify(action.selector)});
      if (!node) return false;
      node.focus();
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      node.value = ${JSON.stringify(action.text)};
      node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      window.__erImeDuringComposition = document.querySelectorAll('#search-results .search-result-item').length;
      node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: ${JSON.stringify(action.text)} }));
      return true;
    })()`, true);
    await new Promise(resolve => setTimeout(resolve, 200));
    return contents.executeJavaScript(ACTION_PROBE, true);
  }
  if (action.type === 'script') {
    await contents.executeJavaScript(action.code, true);
    return contents.executeJavaScript(ACTION_PROBE, true);
  }
  return contents.executeJavaScript(ACTION_PROBE, true);
}

async function settle(contents) {
  // Two animation frames plus a short pause let Leaflet, the virtual list, and the responsive
  // layer finish their queued work before the frame is captured. Windows can suspend rAF for a
  // shown Electron window that temporarily loses foreground eligibility, so the bounded fallback
  // prevents the harness itself from hanging while preserving the frame-based path when available.
  await contents.executeJavaScript(`new Promise(resolve => {
    let complete = false;
    const finish = () => {
      if (complete) return;
      complete = true;
      clearTimeout(deadline);
      resolve();
    };
    const deadline = setTimeout(finish, 750);
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(finish, 120)));
  })`, true);
}

async function correctViewport(window_, scenario) {
  // Fractional Windows display scaling makes setContentSize alone land one or two CSS pixels
  // away from the requested evidence size, which is enough to invalidate an overflow or
  // safe-area assertion. Device emulation pins the CSS viewport exactly; the content-size pass
  // afterwards only keeps the captured window from cropping the emulated view.
  const contents = window_.webContents;
  const desktopEmulation = scenario.width > 767;
  const displayScale = desktopEmulation ? screen.getPrimaryDisplay().scaleFactor : 1;
  contents.setZoomFactor(1 / displayScale);
  const emulatedWidth = Math.round(scenario.width * displayScale);
  const emulatedHeight = Math.round(scenario.height * displayScale);
  if (desktopEmulation) {
    contents.enableDeviceEmulation({
      screenPosition: 'desktop',
      screenSize: { width: emulatedWidth, height: emulatedHeight },
      viewSize: { width: emulatedWidth, height: emulatedHeight },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 1,
      scale: 1
    });
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const measured = await contents.executeJavaScript('({ width: window.innerWidth, height: window.innerHeight })', true);
    if (measured.width === scenario.width && measured.height === scenario.height) return;
    const [currentWidth, currentHeight] = window_.getContentSize();
    window_.setContentSize(
      currentWidth + (scenario.width - measured.width),
      currentHeight + (scenario.height - measured.height)
    );
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

async function runScenario(scenario, baseUrl) {
  const window_ = new BrowserWindow({
    // A shown window is required for a reliable compositor surface: hidden windows return
    // stale frames from capturePage on Windows.
    show: true,
    x: 0,
    y: 0,
    useContentSize: true,
    skipTaskbar: true,
    width: scenario.width,
    height: scenario.height,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
      offscreen: false
    }
  });
  window_.setContentSize(scenario.width, scenario.height);
  const contents = window_.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const consoleMessages = [];
  contents.on('console-message', (_event, level, message) => {
    if (level >= 2) consoleMessages.push(message.slice(0, 300));
  });

  try {
    await contents.loadURL(`${baseUrl}/__seed`);
    await contents.executeJavaScript(seedScript(scenario), true);

    const destination = scenario.destination ? `#${scenario.destination}` : '';
    await contents.loadURL(`${baseUrl}/index.html${destination}`);
    await contents.executeJavaScript(standaloneScript(scenario), true);
    await contents.executeJavaScript(safeAreaScript(scenario), true);

    const ready = await waitFor(contents, "document.querySelectorAll('#station-grid .station-card').length > 0 && document.documentElement.dataset.erUiReady === 'true'");
    await new Promise(resolve => setTimeout(resolve, 400));
    await correctViewport(window_, scenario);
    // Zoom is applied after the viewport is pinned so a 200% scenario reports the CSS viewport a
    // real browser would report at that zoom level rather than fighting the correction loop.
    if (scenario.zoom) {
      const displayScale = scenario.width > 767 ? screen.getPrimaryDisplay().scaleFactor : 1;
      contents.setZoomFactor(scenario.zoom / displayScale);
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    const actionLog = [];
    observedStreamHosts = [];
    for (const action of scenario.actions ?? []) {
      actionLog.push({ action, result: await runAction(window_, action) });
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    await settle(contents);

    const probe = await contents.executeJavaScript(PROBE, true);
    const imeDuringComposition = await contents.executeJavaScript('window.__erImeDuringComposition ?? null', true);
    const image = await retryKnownCaptureError(() => contents.capturePage());
    const file = path.join(outputDirectory, `${scenario.id}.png`);
    await writeFile(file, image.toPNG());

    return {
      id: scenario.id,
      title: scenario.title,
      width: scenario.width,
      height: scenario.height,
      locale: scenario.locale || 'en',
      theme: scenario.theme || 'light',
      standalone: Boolean(scenario.standalone),
      zoom: scenario.zoom || 1,
      ready,
      screenshot: path.relative(repositoryRoot, file).replaceAll(path.sep, '/'),
      imeDuringComposition,
      actionLog,
      streamHosts: [...observedStreamHosts],
      consoleErrors: consoleMessages,
      probe
    };
  } catch (error) {
    return { id: scenario.id, title: scenario.title, error: String(error?.stack || error) };
  } finally {
    try {
      contents.disableDeviceEmulation();
    } catch {
      /* the renderer may already be gone */
    }
    window_.destroy();
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

// Each scenario destroys its window before the next one opens, so the default
// window-all-closed handler would quit the app partway through the matrix.
app.on('window-all-closed', () => {});

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-lcd-text');

app.whenReady().then(async () => {
  await session.defaultSession.clearCache();
  await mkdir(outputDirectory, { recursive: true });
  installHttpsFixtures();
  const { server, port } = await startStaticServer();
  const baseUrl = `http://127.0.0.1:${port}`;
  const resultsFile = path.join(outputDirectory, 'results.json');
  const results = [];
  // Results are written after every scenario. A renderer that dies late in a long matrix would
  // otherwise discard every earlier capture and hide which scenario actually failed.
  const persist = async complete => writeFile(
    resultsFile,
    `${JSON.stringify({
      schemaVersion: 1,
      generatedBy: 'tests/browser/harness-main.mjs',
      complete,
      expected: scenarios.map(item => item.id),
      results
    }, null, 2)}\n`
  );
  await persist(false);
  for (const scenario of scenarios) {
    process.stderr.write(`RENDERED_SCENARIO ${scenario.id}\n`);
    results.push(await runScenario(scenario, baseUrl));
    await persist(false);
  }
  await persist(true);
  server.close();
  await rm(harnessProfile, { recursive: true, force: true }).catch(() => {});
  process.stdout.write(`RENDERED_RESULTS ${resultsFile}\n`);
  app.exit(results.some(result => result.error) ? 1 : 0);
});
