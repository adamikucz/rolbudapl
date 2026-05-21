const CACHE_NAME = 'pzs2-cache-v4';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/sitemap.xml',
  '/assets/favicon.png',
  '/assets/logo-rolbudy.png',
  '/assets/school-placeholder.jpg'
];

const API_PATHS = [
  '/api/substitutions',
  '/api/news',
  '/api/plan',
  '/api/classes',
  '/api/departures'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(
        STATIC_ASSETS.map((asset) => new Request(asset, { cache: 'reload' }))
      );
    })
  );

  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
        return Promise.resolve();
      })
    );

    await self.clients.claim();

    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    clients.forEach((client) => {
      client.postMessage({ type: 'APP_UPDATED', cacheName: CACHE_NAME });
    });
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isApiRequest = API_PATHS.some((path) => url.pathname.includes(path));

  if (isApiRequest) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.json') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.jpeg') ||
      url.pathname.endsWith('.webp') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.ico'))
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);

  if (cached) return cached;

  try {
    const response = await fetch(request);

    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }

    return response;
  } catch {
    return caches.match('/index.html');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fresh = fetch(request, { cache: 'no-store' })
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || fresh || caches.match('/index.html');
}

async function networkFirst(request, fallbackUrl = null) {
  try {
    const response = await fetch(request, { cache: 'no-store' });

    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cached = await caches.match(request);

    if (cached) return cached;

    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }

    return new Response(
      JSON.stringify({ offline: true }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        }
      }
    );
  }
}
