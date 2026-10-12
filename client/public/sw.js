/* Public, versioned application assets only. Private offline data lives in account-scoped IndexedDB. */
const CACHE_NAME = 'zabsync-public-shell-v3-__ZABSYNC_BUILD__';
// The production post-build script replaces this list with every emitted, approved public asset.
const PUBLIC_FILES = /* __ZABSYNC_PUBLIC_ASSETS__ */ ['/index.html', '/offline.html', '/manifest.webmanifest', '/icons/zabsync-icon.png', '/icons/zabsync-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_FILES)));
  // Do not skipWaiting here. An existing tab can have unsaved form content.
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME &&
      (key.startsWith('zabsync-public-shell-') || key.startsWith('xvia-public-connection-')))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ZABSYNC_ACTIVATE_UPDATE' || event.data?.type === 'XVIA_ACTIVATE_UPDATE')
    event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'ZABSYNC_OFFLINE_STATUS' && event.ports?.[0]) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const present = await Promise.all(PUBLIC_FILES.map((path) => cache.match(path)));
      // A source/dev worker without built chunks cannot report successful app preparation.
      event.ports[0].postMessage({ ready: present.every(Boolean) && PUBLIC_FILES.some((path) => /^\/assets\/.+\.js$/.test(path)), version: CACHE_NAME });
    })());
  }
});
self.addEventListener('fetch', (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('Authorization')) return;
  if (/^\/(api|__\/auth|uploads|downloads|files)(\/|$)/.test(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match('/index.html')) || (await cache.match('/offline.html')) ||
        new Response('ZabSync is offline. Reconnect and open the app once to prepare this device.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }));
  } else if (!url.search && PUBLIC_FILES.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => (await cache.match(url.pathname)) || fetch(request)));
  }
  // Arbitrary routes, query URLs, API responses, avatars and lecture downloads never enter Cache Storage.
});
