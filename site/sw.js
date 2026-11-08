const CACHE_NAME = 'earth-radio-shell-v63-public-domains';
const SHELL_ASSETS = [
  './',
  './index.html',
  './config.js?v=0.29.1',
  './assets/auth-deployment.js?v=0.29.1',
  './assets/desktop-auth.js?v=0.29.1',
  './manifest.webmanifest',
  './branding/earth-radio-32-v2.png',
  './branding/earth-radio-180-v2.png',
  './branding/earth-radio-192-v2.png',
  './branding/earth-radio-512-v2.png',
  './assets/hls.light-Dr1Fv81C.js',
  './assets/index-b6ef62ee.js',
  './assets/index-CSoL7F-Y.css',
  './assets/storage-guard.js?v=0.29.1',
  './assets/directory-expansion.js?v=0.29.1',
  './assets/pinned-stations.js?v=0.29.1',
  './assets/metadata-enrichment.js?v=0.29.1',
  './assets/metadata-enrichment.css?v=0.29.1',
  './assets/responsive-ui.css?v=0.29.1',
  './assets/responsive-ui.js?v=0.29.1',
  './assets/ui-refresh.css?v=0.29.1',
  './assets/atlas-lock.css?v=0.29.1',
  './assets/atlas-lock.js?v=0.29.1',
  './assets/discovery-core.js?v=0.29.1',
  './assets/map-directory.js?v=0.29.1',
  './assets/discovery-ui.js?v=0.29.1',
  './assets/discovery.css?v=0.29.1',
  './assets/listening-room.css?v=0.29.1',
  './assets/vector-atlas.js?v=0.29.1',
  './assets/world-land.js?v=0.29.1',
  './assets/map-core.js?v=0.29.1',
  './assets/map-world.js',
  './assets/map-detail.js',
  './assets/map-terrain.js',
  './assets/map-roads.js',
  './map-data-notices.txt',
  './assets/auth-core.js?v=0.29.1',
  './assets/sync-core.js?v=0.29.1',
  './assets/song-library-core.js?v=0.29.1',
  './assets/song-library-store.js?v=0.29.1',
  './assets/song-library-ui.js?v=0.29.1',
  './assets/auth-ui.js?v=0.29.1',
  './assets/auth-ui.css?v=0.29.1',
  './i18n/index.js?v=0.29.1',
  './i18n/en.js?v=0.29.1',
  './i18n/es.js?v=0.29.1',
  './i18n/ar.js?v=0.29.1',
  './i18n/ko.js?v=0.29.1',
  './i18n/zh-Hans.js?v=0.29.1',
  './i18n/zh-Hant.js?v=0.29.1'
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
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Only navigations may fall back to the shell document; serving HTML for a
    // script/style request breaks module MIME checks while offline.
    if (request.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
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
  return /index-b6ef62ee|index-CSoL7F-Y|hls\.light-Dr1Fv81C/.test(pathname);
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
