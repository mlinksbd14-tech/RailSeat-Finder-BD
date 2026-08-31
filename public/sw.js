// RailSeat Finder BD - High Performance Service Worker & Web Push Engine
const CACHE_NAME = 'railseat-finder-v7.6';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/favicon.ico',
  '/manifest.json'
];

// 1. Install & Cache Core Shell Assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Cache addAll warning:', err.message);
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate & Clean Old Caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Strategy: Network-First for core shell assets and APIs, cache fallback for offline
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always use network directly for API queries & dynamic server endpoints
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-First for core application shell
  const isCoreAsset = url.pathname === '/' || 
                      url.pathname === '/index.html' || 
                      url.pathname.endsWith('.js') || 
                      url.pathname.endsWith('.css');

  if (isCoreAsset) {
    event.respondWith(
      fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Stale-While-Revalidate for other static assets (images, fonts, favicons)
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// 4. Background Push Notification Event Handler (Web Push Alerts)
self.addEventListener('push', event => {
  let payload = {
    title: '🚆 RailSeat BD - Seat Available!',
    body: 'New train seats have been detected on your watchlist!',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    url: '/',
    data: {}
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch (e) {
      payload.body = event.data.text() || payload.body;
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || '/favicon.ico',
    badge: payload.badge || '/favicon.ico',
    vibrate: [200, 100, 200, 100, 200],
    data: {
      url: payload.url || '/',
      bookUrl: payload.bookUrl || null
    },
    actions: [
      { action: 'open', title: '🔍 Open Dashboard' },
      ...(payload.bookUrl ? [{ action: 'book', title: '🎟️ Book Now' }] : [])
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// 5. Notification Click Action Router
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  let targetUrl = data.url || '/';

  if (event.action === 'book' && data.bookUrl) {
    targetUrl = data.bookUrl;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
