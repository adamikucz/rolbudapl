const CACHE_NAME = "pzs2-cache-v5";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/manifest.json",
  "/sitemap.xml",
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
    url.pathname.includes("/api/classes") ||
    url.pathname.includes("/api/departures")
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

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      body: event.data ? event.data.text() : "Masz nowe powiadomienie z Rolbudy."
    };
  }

  const title = payload.title || "Rolbuda";
  const options = {
    body: payload.body || "Sprawdź najnowsze informacje w aplikacji.",
    icon: payload.icon || "/assets/icon-192.png",
    badge: payload.badge || "/assets/favicon.png",
    tag: payload.tag || "rolbuda-update",
    renotify: Boolean(payload.renotify),
    requireInteraction: Boolean(payload.requireInteraction),
    data: {
      url: payload.url || "/"
    }
  };

  if (Array.isArray(payload.actions) && payload.actions.length) {
    options.actions = payload.actions.slice(0, 2);
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification?.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
