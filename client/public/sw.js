/* Public, versioned application assets only. Private offline data lives in account-scoped IndexedDB. */
const CACHE_NAME = 'zabsync-public-shell-v4-__ZABSYNC_BUILD__';
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
  if (/^\/(api|oauth|__\/auth|uploads|downloads|files)(\/|$)/.test(url.pathname)) return;
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

// Data-only reminder delivery. Never expose deadline titles, subjects or student data on a lock screen.
self.addEventListener('push', (event) => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  const id = payload?.data?.zabsyncReminderId;
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) return;
  event.waitUntil(self.registration.showNotification('ZabSync reminder', {
    body: 'You have a deadline reminder. Open ZabSync to see the details.',
    icon: '/icons/zabsync-icon.png', badge: '/icons/zabsync-icon.png',
    tag: `zabsync-reminder-${id}`, data: { zabsyncReminder: true },
  }));
});
self.addEventListener('notificationclick', (event) => {
  if (!event.notification.data?.zabsyncReminder) return;
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.navigate('/reminders'); return client.focus();
      }
    }
    return self.clients.openWindow('/reminders');
  })());
});
