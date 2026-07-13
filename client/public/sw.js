// Migration worker: retire the old restaurant-v1 cache-first worker.
// The application uses owner-scoped IndexedDB caching and does not register a
// background sync, so retaining a fetch-intercepting worker adds stale-release
// and cross-user cache risk without providing an offline guarantee.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
  })());
});
