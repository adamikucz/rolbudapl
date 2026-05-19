const CACHE_NAME = "pzs2-cache-v1";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/manifest.json",
  "/assets/favicon.png",
  "/assets/logo-rolbudy.png",
  "/assets/school-placeholder.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API — network first
  if (
    url.pathname.includes("/api/substitutions") ||
    url.pathname.includes("/api/news") ||
    url.pathname.includes("/api/plan") ||
    url.pathname.includes("/api/classes")
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Reszta — cache first
  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);

    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());

    return response;
  } catch {
    return caches.match("/index.html");
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);

    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());

    return response;
  } catch {
    const cached = await caches.match(request);

    if (cached) {
      return cached;
    }

    return new Response(
      JSON.stringify({
        offline: true
      }),
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}