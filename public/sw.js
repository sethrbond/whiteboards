// Self-unregistering service worker — cleans up old cached versions
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {
  self.registration.unregister();
  caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
});
