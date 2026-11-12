const CACHE_NAME = 'earth-radio-shell-v81-station-sharing';
const SHELL_ASSETS = [
  './assets/direct-stations.js?v=0.37.0',
  './assets/station-record-protocol.js?v=0.37.0',
  './assets/sharing-core.js?v=0.37.0',
  './assets/sharing-entry.js?v=0.37.0',
  './assets/sharing-ui.js?v=0.37.0',
  './assets/media-session-core.js?v=0.37.0',
  './assets/media-session-artwork.js?v=0.37.0',
  './assets/media-session.js?v=0.37.0',
  './assets/passport-core.js?v=0.37.0',
  './assets/passport-policy.js?v=0.37.0',
  './assets/passport-store.js?v=0.37.0',
  './assets/passport-map.js?v=0.37.0',
  './assets/passport-ui.js?v=0.37.0',
  './assets/user-transfer.js?v=0.37.0',
  './assets/map-country-identifiers.js?v=0.37.0',
  './assets/place-copy.js?v=0.37.0',
  './assets/place-ui.js?v=0.37.0',
  './assets/today-ui.js?v=0.37.0',
  './assets/today-ui.css?v=0.37.0',
  './assets/today-core.js?v=0.37.0',
  './assets/program-components.js?v=0.37.0',
  './assets/place-core.js?v=0.37.0',
  './assets/curated-places.js?v=0.37.0',
  './',
  './404.html',
  './not-found.css?v=0.37.0',
  './privacy',
  './branding/earth-radio-logo.svg',
  './config.js?v=0.37.0',
  './assets/auth-deployment.js?v=0.37.0',
  './assets/desktop-auth.js?v=0.37.0',
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
  './assets/index-d26191ab.js',
  './assets/index-CSoL7F-Y.css',
  './assets/storage-guard.js?v=0.37.0',
  './assets/directory-expansion.js?v=0.37.0',
  './assets/pinned-stations.js?v=0.37.0',
  './assets/metadata-enrichment.js?v=0.37.0',
  './assets/metadata-enrichment.css?v=0.37.0',
  './assets/responsive-ui.css?v=0.37.0',
  './assets/responsive-ui.js?v=0.37.0',
  './assets/ui-refresh.css?v=0.37.0',
  './assets/atlas-lock.css?v=0.37.0',
  './assets/atlas-lock.js?v=0.37.0',
  './assets/search-core.js?v=0.37.0',
  './assets/place-vocabulary.js?v=0.37.0',
  './assets/country-locations.js?v=0.37.0',
  './assets/station-location.js?v=0.37.0',
  './assets/map-viewport.js?v=0.37.0',
  './assets/directory-client.js?v=0.37.0',
  './assets/station-variants.js?v=0.37.0',
  './assets/snapshot-protocol.js?v=0.37.0',
  './assets/directory-status.js?v=0.37.0',
  './assets/directory-hosts.js?v=0.37.0',
  './assets/facet-picker.js?v=0.37.0',
  './assets/search-controls.js?v=0.37.0',
  './assets/search-controls.css?v=0.37.0',
  './assets/discovery-core.js?v=0.37.0',
  './assets/map-directory.js?v=0.37.0',
  './assets/discovery-ui.js?v=0.37.0',
  './assets/playback-intent.js?v=0.37.0',
  './assets/station-clicks.js?v=0.37.0',
  './assets/discovery.css?v=0.37.0',
  './assets/listening-room.css?v=0.37.0',
  './assets/brand-identity.css?v=0.37.0',
  './assets/brand-identity.js?v=0.37.0',
  './assets/vector-atlas.js?v=0.37.0',
  './assets/world-land.js?v=0.37.0',
  './assets/map-core.js?v=0.37.0',
  './map-data-notices.txt',
  './assets/auth-core.js?v=0.37.0',
  './assets/sync-core.js?v=0.37.0',
  './assets/song-library-core.js?v=0.37.0',
  './assets/song-library-store.js?v=0.37.0',
  './assets/song-library-ui.js?v=0.37.0',
  './assets/auth-ui.js?v=0.37.0',
  './assets/auth-ui.css?v=0.37.0',
  './i18n/index.js?v=0.37.0',
  './i18n/en.js?v=0.37.0',
  './i18n/es.js?v=0.37.0',
  './i18n/ar.js?v=0.37.0',
  './i18n/ko.js?v=0.37.0',
  './i18n/zh-Hans.js?v=0.37.0',
  './i18n/zh-Hant.js?v=0.37.0'
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
  const url = new URL(request.url);
  const shell = url.pathname === '/' || url.pathname === '/index.html';
  const privacy = url.pathname === '/privacy' || url.pathname === '/privacy.html';
  const cacheable = request.mode !== 'navigate' || (!url.search && (shell || privacy));
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
    if (request.mode === 'navigate') {
      if (shell) return (await caches.match('./')) || Response.error();
      if (privacy) return (await caches.match('./privacy')) || Response.error();
      const missing = await caches.match('./404.html');
      return new Response(missing?.body || 'Page not found', { status: 404, statusText: 'Not Found',
        headers: missing?.headers || { 'content-type': 'text/plain; charset=utf-8' } });
    }
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
  return /index-d26191ab|index-CSoL7F-Y|hls\.light-Dr1Fv81C|map-(?:world|detail|terrain|roads)-[a-f0-9]{8}\.js/.test(pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' || url.pathname === '/not-found.css' || url.pathname.endsWith('/config.js') || url.pathname.endsWith('/manifest.webmanifest') || url.pathname.includes('/branding/') || url.pathname.includes('/i18n/') || url.pathname.includes('responsive-ui') || url.pathname.includes('atlas-lock')) {
    event.respondWith(networkFirst(request));
  } else if (url.pathname.includes('/assets/') && isImmutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(networkFirst(request));
  }
});
