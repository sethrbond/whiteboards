// Service Worker — cache-first for static assets, network-first for API calls
const CACHE_NAME = 'whiteboards-v2';

// App shell files to pre-cache on install
const APP_SHELL = [
  '/',
  '/index.html',
];

// Install: pre-cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for static assets, network-first for API calls
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never cache Supabase API calls
  if (url.hostname.endsWith('supabase.co')) return;

  // Never cache non-GET requests
  if (e.request.method !== 'GET') return;

  // Never cache the Anthropic API
  if (url.hostname === 'api.anthropic.com') return;

  // Static assets: cache-first (JS, CSS, fonts, images)
  const isStatic = /\.(js|css|woff2?|ttf|eot|png|jpg|jpeg|svg|gif|ico|webp)(\?.*)?$/.test(url.pathname);

  if (isStatic) {
    // Cache-first strategy
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((response) => {
          // Only cache successful responses
          if (!response || response.status !== 200) return response;
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // HTML/navigation: network-first strategy
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
