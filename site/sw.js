const CACHE_NAME = 'earth-radio-shell-v24-recovered-3';
const SHELL_ASSETS = [
  './assets/hls.light-Dr1Fv81C.js',
  './assets/index-B4rKOAHV.js',
  './assets/index-CSoL7F-Y.css',
  './assets/metadata-enrichment.js',
  './assets/metadata-enrichment.css'
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

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' || url.pathname.endsWith('/config.js')) {
    event.respondWith(networkFirst(request));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request));
  }
});
