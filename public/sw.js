/**
 * Service Worker for BISCUITS
 * Provides offline caching and improves load performance
 */

const CACHE_NAME = 'biscuits-v4';
const RUNTIME_CACHE = 'biscuits-runtime-v4';

// Assets to cache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

/**
 * Install event - precache essential assets
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precaching assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[SW] Skip waiting');
        return self.skipWaiting();
      })
  );
});

/**
 * Activate event - cleanup old caches
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Claiming clients');
        return self.clients.claim();
      })
  );
});

/**
 * Fetch event - serve from cache, fallback to network
 * Strategy: Cache first, falling back to network for essential assets
 * Network first for API calls and dynamic content
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET requests. Cache API does not support PUT/POST/etc.
  if (request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  // Skip chrome extension and dev server requests
  if (url.protocol === 'chrome-extension:' || url.hostname === 'localhost') {
    return;
  }

  // Network first for navigation so new deployments are picked up quickly.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, { cacheResponse: true }));
    return;
  }

  // Network first for API calls; do not cache dynamic API responses.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, { cacheResponse: false }));
    return;
  }

  // Cache first for assets
  event.respondWith(cacheFirst(request));
});

/**
 * Cache first strategy - try cache, fallback to network
 */
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    console.log('[SW] Cache hit:', request.url);
    return cachedResponse;
  }

  console.log('[SW] Cache miss, fetching:', request.url);

  try {
    const networkResponse = await fetch(request);

    // Cache successful responses
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.error('[SW] Fetch failed:', error);

    // Silently fail for missing icons (they're optional)
    const url = new URL(request.url);
    if (url.pathname.includes('icon-') || url.pathname.includes('screenshot-')) {
      console.log('[SW] Icon/screenshot not found, skipping gracefully');
      return new Response('', { status: 404 });
    }

    // Return offline fallback if available
    const fallback = await caches.match('./index.html');
    if (fallback) {
      return fallback;
    }

    throw error;
  }
}

/**
 * Network first strategy - try network, fallback to cache
 */
async function networkFirst(request, options = {}) {
  const cacheResponse = options.cacheResponse !== false;

  try {
    const networkResponse = await fetch(request);

    // Cache successful responses
    if (cacheResponse && networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);

    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    throw error;
  }
}

/**
 * Message event - handle messages from clients
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CACHE_URLS') {
    const urls = event.data.urls;
    caches.open(RUNTIME_CACHE).then((cache) => {
      cache.addAll(urls);
    });
  }

  if (event.data && event.data.type === 'SYNC_GAME_LOGS') {
    const endpoint = event.data.endpoint;
    const logs = Array.isArray(event.data.logs) ? event.data.logs : [];
    const replyPort = event.ports && event.ports[0] ? event.ports[0] : null;

    if (!endpoint || logs.length === 0) {
      if (replyPort) {
        replyPort.postMessage({ ok: false, accepted: 0 });
      }
      return;
    }

    fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ logs }),
    })
      .then(async (response) => {
        if (!replyPort) return;
        if (!response.ok) {
          replyPort.postMessage({ ok: false, accepted: 0 });
          return;
        }

        let accepted = logs.length;
        try {
          const body = await response.json();
          if (typeof body.accepted === 'number') {
            accepted = Math.max(0, Math.floor(body.accepted));
          }
        } catch (error) {
          // Keep default accepted count when response body is empty/non-JSON.
        }

        replyPort.postMessage({ ok: true, accepted });
      })
      .catch(() => {
        if (replyPort) {
          replyPort.postMessage({ ok: false, accepted: 0 });
        }
      });
  }
});
