/* Tagalong service worker: the whole app shell is cached, so the app opens with no signal.
   The receipt reader (vendor/ocr) is cached the first time it is used. */
const VERSION = "tagalong-v5";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "core.js",
  "live.js",
  "world.js",
  "app.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok && !url.search) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached || cache.match("index.html"));
      return cached || fresh;
    })
  );
});
