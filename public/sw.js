/* Guess My Answer — service worker.
 *
 * Enough to make the game installable and to survive a dead spot in the
 * signal. Deliberately small: there is no precache manifest to go stale,
 * because the built asset filenames are content-hashed by Vite anyway.
 */

const CACHE = "gma-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Room state and health must never be served stale.
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") return;

  // Navigations: network first so a new deploy is picked up immediately,
  // falling back to the cached shell when there is no signal.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put("/", fresh.clone());
          return fresh;
        } catch (err) {
          const cache = await caches.open(CACHE);
          return (await cache.match("/")) || Response.error();
        }
      })()
    );
    return;
  }

  // Everything else (hashed assets, icons, manifest): serve from cache when
  // we have it, and refresh in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })()
  );
});
