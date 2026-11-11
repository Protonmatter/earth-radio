const CACHE_NAME = 'earth-radio-shell-v70-playback-intent';
const SHELL_ASSETS = [
  './',
  './config.js?v=0.32.1',
  './assets/auth-deployment.js?v=0.32.1',
  './assets/desktop-auth.js?v=0.32.1',
  './manifest.webmanifest',
  './branding/earth-radio-favicon-pine.svg',
  './branding/earth-radio-favicon-obsidian.svg',
  './branding/earth-radio-favicon-pine-16.png',
  './branding/earth-radio-favicon-pine-32.png',
  './branding/earth-radio-favicon-obsidian-16.png',
  './branding/earth-radio-favicon-obsidian-32.png',
  './branding/earth-radio-apple-touch-icon-180.png',
  './branding/earth-radio-app-icon-192.png',
  './branding/earth-radio-app-icon-512.png',
  './branding/earth-radio-maskable-icon-512.png',
  './branding/earth-radio-maskable-icon-1024.png',
  './assets/hls.light-Dr1Fv81C.js',
  './assets/index-1d06892a.js',
  './assets/index-CSoL7F-Y.css',
  './assets/storage-guard.js?v=0.32.1',
  './assets/directory-expansion.js?v=0.32.1',
  './assets/pinned-stations.js?v=0.32.1',
  './assets/metadata-enrichment.js?v=0.32.1',
  './assets/metadata-enrichment.css?v=0.32.1',
  './assets/responsive-ui.css?v=0.32.1',
  './assets/responsive-ui.js?v=0.32.1',
  './assets/ui-refresh.css?v=0.32.1',
  './assets/atlas-lock.css?v=0.32.1',
  './assets/atlas-lock.js?v=0.32.1',
  './assets/search-core.js?v=0.32.1',
  './assets/place-vocabulary.js?v=0.32.1',
  './assets/country-locations.js?v=0.32.1',
  './assets/station-location.js?v=0.32.1',
  './assets/map-viewport.js?v=0.32.1',
  './assets/directory-client.js?v=0.32.1',
  './assets/station-variants.js?v=0.32.1',
  './assets/snapshot-protocol.js?v=0.32.1',
  './assets/directory-status.js?v=0.32.1',
  './assets/directory-hosts.js?v=0.32.1',
  './assets/facet-picker.js?v=0.32.1',
  './assets/search-controls.js?v=0.32.1',
  './assets/search-controls.css?v=0.32.1',
  './assets/discovery-core.js?v=0.32.1',
  './assets/map-directory.js?v=0.32.1',
  './assets/discovery-ui.js?v=0.32.1',
  './assets/playback-intent.js?v=0.32.1',
  './assets/discovery.css?v=0.32.1',
  './assets/listening-room.css?v=0.32.1',
  './assets/brand-identity.css?v=0.32.1',
  './assets/brand-identity.js?v=0.32.1',
  './assets/vector-atlas.js?v=0.32.1',
  './assets/world-land.js?v=0.32.1',
  './assets/map-core.js?v=0.32.1',
  './map-data-notices.txt',
  './assets/auth-core.js?v=0.32.1',
  './assets/sync-core.js?v=0.32.1',
  './assets/song-library-core.js?v=0.32.1',
  './assets/song-library-store.js?v=0.32.1',
  './assets/song-library-ui.js?v=0.32.1',
  './assets/auth-ui.js?v=0.32.1',
  './assets/auth-ui.css?v=0.32.1',
  './i18n/index.js?v=0.32.1',
  './i18n/en.js?v=0.32.1',
  './i18n/es.js?v=0.32.1',
  './i18n/ar.js?v=0.32.1',
  './i18n/ko.js?v=0.32.1',
  './i18n/zh-Hans.js?v=0.32.1',
  './i18n/zh-Hant.js?v=0.32.1'
];

self.addEventListener('install', event => {
  const shellRequests = SHELL_ASSETS.map(asset => new Request(asset, {
    cache: isImmutableAsset(asset) ? 'force-cache' : 'reload'
  }));
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(shellRequests))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))),
      self.clients.claim()
    ])
  );
});

async function networkFirst(request) {
  // The application routes through hashes. Query-bearing navigations can carry
  // one-time sign-in data and must never become persistent cache keys/responses.
  const cacheable = request.mode !== 'navigate' || !new URL(request.url).search;
  try {
    const response = await fetch(request);
    if (response.ok && cacheable) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = cacheable ? await caches.match(request) : null;
    if (cached) return cached;
    // Only navigations may fall back to the shell document; serving HTML for a
    // script/style request breaks module MIME checks while offline.
    if (request.mode === 'navigate') return (await caches.match('./')) || Response.error();
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

function isImmutableAsset(pathname) {
  return /index-1d06892a|index-CSoL7F-Y|hls\.light-Dr1Fv81C|map-(?:world|detail|terrain|roads)-[a-f0-9]{8}\.js/.test(pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' || url.pathname.endsWith('/config.js') || url.pathname.endsWith('/manifest.webmanifest') || url.pathname.includes('/branding/') || url.pathname.includes('/i18n/') || url.pathname.includes('responsive-ui') || url.pathname.includes('atlas-lock')) {
    event.respondWith(networkFirst(request));
  } else if (url.pathname.includes('/assets/') && isImmutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(networkFirst(request));
  }
});
