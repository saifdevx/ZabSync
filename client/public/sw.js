/* XVIA checkpoint 2: public connection fallback only. Academic offline sync is checkpoint 3. */
const CACHE_NAME = 'xvia-public-connection-v2-__XVIA_BUILD__';
const PUBLIC_FILES = ['/offline.html', '/icons/xvia-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_FILES)));
  // Do not skip waiting automatically: students may have unsaved work open.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('xvia-public-connection-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'XVIA_ACTIVATE_UPDATE') {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    request.headers.has('Authorization')
  )
    return;
  // Never intercept/cache APIs, authentication, profile photos, uploads, or signed downloads.
  if (/^\/(api|__\/auth|uploads|downloads|files)(\/|$)/.test(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.open(CACHE_NAME).then((cache) => cache.match('/offline.html'));
        return (
          cached ||
          new Response('XVIA is offline. Reconnect and reload to continue.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        );
      }),
    );
  } else if (!url.search && PUBLIC_FILES.includes(url.pathname)) {
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then(async (cache) => (await cache.match(url.pathname)) || fetch(request)),
    );
  }
});
