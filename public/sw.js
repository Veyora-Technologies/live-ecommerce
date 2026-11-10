// Furnivo service worker: cache immutable/public assets only.
// HTML and all API/auth/account/merchant data remain network-only so cached
// inventory is never implied to be current and private pages aren't shared.
const CACHE = "live-brand-static-1";
const STATIC_SHELL = [
  "/offline.html",
  "/manifest.json",
  "/icon.svg",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
];
const STATIC_PREFIXES = ["/_next/static/"];
const STATIC_FILES = /\.(?:css|js|mjs|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|ico)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data === "LIVE_SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("live-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/profile") || url.pathname.startsWith("/my-live") || url.pathname.startsWith("/saved") || url.pathname.startsWith("/cart") || url.pathname.startsWith("/lists") || url.pathname.startsWith("/activity") || url.pathname.startsWith("/merchant") || url.pathname.startsWith("/admin")) return;

  const staticAsset = STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) || STATIC_FILES.test(url.pathname);
  if (staticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok && response.type === "basic") caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
          return response;
        });
        return cached || network;
      }),
    );
    return;
  }

  // Navigations are network-only. Only a purpose-written, non-sensitive offline
  // explainer may be served if the network is unavailable; no dynamic page HTML
  // or server-rendered user data is cached.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/offline.html")) || new Response("You're offline. Reconnect to see current availability.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
  }
});
