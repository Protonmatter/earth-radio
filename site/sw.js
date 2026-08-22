const CACHE_NAME = 'earth-radio-shell-v25-responsive-2';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/hls.light-Dr1Fv81C.js',
  './assets/index-B4rKOAHV.js',
  './assets/index-CSoL7F-Y.css',
  './assets/metadata-enrichment.js',
  './assets/metadata-enrichment.css',
  './assets/responsive-ui.css',
  './assets/responsive-ui.js',
  './i18n/index.js',
  './i18n/en.js',
  './i18n/es.js',
  './i18n/ar.js',
  './i18n/ko.js',
  './i18n/zh-Hans.js',
  './i18n/zh-Hant.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)).catch(() => undefined));
  self.skipWaiting();
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
    return (await caches.match(request)) || (await caches.match('./index.html')) || Response.error();
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
  return /index-B4rKOAHV|index-CSoL7F-Y|hls\.light-Dr1Fv81C/.test(pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' || url.pathname.endsWith('/config.js') || url.pathname.includes('/i18n/') || url.pathname.includes('responsive-ui')) {
    event.respondWith(networkFirst(request));
  } else if (url.pathname.includes('/assets/') && isImmutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(networkFirst(request));
  }
});
