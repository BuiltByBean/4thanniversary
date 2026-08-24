/* Guess My Answer — service worker.
 *
 * Enough to make the game installable and to survive a dead spot in the
 * signal. Deliberately narrow: only the content-hashed build assets are
 * cached, because their filenames change whenever their contents do.
 *
 * Everything else — icons, the manifest, room state — goes to the network.
 * An earlier version cached icons cache-first, which pinned a broken PNG on
 * a phone and kept serving it after the fix had already shipped. Not again.
 */

const CACHE = "gma-v3";

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

  // Only the hashed build output is safe to serve from cache, since a change
  // to any of it produces a new filename.
  if (!url.pathname.startsWith("/assets/")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })()
  );
});
