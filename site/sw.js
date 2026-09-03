const CACHE_NAME = 'earth-radio-shell-v46-atlas-lock-1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './assets/hls.light-Dr1Fv81C.js',
  './assets/index-690938fe.js',
  './assets/index-CSoL7F-Y.css',
  './assets/storage-guard.js',
  './assets/directory-expansion.js',
  './assets/pinned-stations.js',
  './assets/metadata-enrichment.js',
  './assets/metadata-enrichment.css',
  './assets/responsive-ui.css',
  './assets/responsive-ui.js',
  './assets/ui-refresh.css',
  './assets/atlas-lock.css',
  './assets/atlas-lock.js',
  './assets/auth-core.js',
  './assets/sync-core.js',
  './assets/auth-ui.js',
  './assets/auth-ui.css',
  './i18n/index.js',
  './i18n/en.js',
  './i18n/es.js',
  './i18n/ar.js',
  './i18n/ko.js',
  './i18n/zh-Hans.js',
  './i18n/zh-Hant.js'
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
  return /index-690938fe|index-CSoL7F-Y|hls\.light-Dr1Fv81C/.test(pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' || url.pathname.endsWith('/config.js') || url.pathname.includes('/i18n/') || url.pathname.includes('responsive-ui') || url.pathname.includes('atlas-lock')) {
    event.respondWith(networkFirst(request));
  } else if (url.pathname.includes('/assets/') && isImmutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(networkFirst(request));
  }
});
