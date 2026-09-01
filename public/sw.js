const CACHE_NAMESPACE = "quotepilot-shell-";
const CACHE_VERSION = `${CACHE_NAMESPACE}v3`;
const CORE_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/brand/quotepilot-mark.svg",
  "/brand/quotepilot-mark-192.png",
  "/brand/quotepilot-mark-512.png"
];

function isCacheableStaticRequest(request, url) {
  return request.method === "GET"
    && url.origin === self.location.origin
    && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/brand/"));
}

function isSafeStaticResponse(response) {
  if (!response || !response.ok || response.type !== "basic") return false;
  const cacheControl = String(response.headers?.get("cache-control") || "");
  return !/(?:^|,)\s*(?:no-store|private)\b/i.test(cacheControl);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_NAMESPACE) && key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  if (!isCacheableStaticRequest(req, url)) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then(async (response) => {
          if (isSafeStaticResponse(response)) {
            const clone = response.clone();
            await caches.open(CACHE_VERSION)
              .then((cache) => cache.put(req, clone))
              .catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
