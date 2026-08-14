// OpenCode WebUI service worker: offline app shell + static asset caching.
// Never touches /api/* (BFF proxy + SSE streams) so live data stays live.

// v6: build-id aware cache invalidation that actually clears the navigation
// cache. v5 wiped a `BUILD_CACHE` that nothing ever wrote to, so a stale
// cached "/" (referencing deleted _next chunks) survived deploys. v6 also
// caches /_next/static/* so the offline shell is functional: the cached HTML
// can load its (also cached) JS chunks.
const CACHE = "leafcode-v6";
const APP_SHELL = ["/", "/manifest.webmanifest"];

let activeBuildId = "";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}),
  );
  self.skipWaiting();
});

async function wipeCache() {
  await caches.delete(CACHE);
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (
    data &&
    typeof data === "object" &&
    data.type === "BUILD_ID" &&
    typeof data.id === "string"
  ) {
    const incoming = data.id.trim();
    if (!incoming) return;
    if (activeBuildId && activeBuildId !== incoming) {
      // A new build replaced web/.next: drop every cached entry (the old
      // navigation HTML references _next chunk hashes that no longer exist).
      event.waitUntil(
        wipeCache().then(() => {
          activeBuildId = incoming;
        }),
      );
      return;
    }
    activeBuildId = incoming;
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

function cachePut(request, response) {
  // Do not cache non-OK responses (4xx, 5xx, or undefined ok).
  // response.ok === true means status 200-299.
  if (response.ok !== true) return;
  const copy = response.clone();
  caches
    .open(CACHE)
    .then((cache) => cache.put(request, copy))
    .catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Bypass BFF/API and SSE entirely.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first, fall back to cached page then app shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          cachePut(req, res);
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match("/")),
        ),
    );
    return;
  }

  // Next build assets are versioned per deployment and the CACHE is wiped
  // whenever the build id changes, so stale chunks cannot outlive a deploy.
  // Cache-first keeps the offline shell working: the cached navigation HTML
  // references these hashed chunks, which must be present offline too.
  if (url.pathname.startsWith("/_next/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            cachePut(req, res);
            return res;
          }),
      ),
    );
    return;
  }

  // Static assets: cache-first, populate on miss.
  const isStatic =
    /\.(?:png|svg|ico|webmanifest|woff2?|css|js)$/.test(url.pathname);
  if (isStatic) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            cachePut(req, res);
            return res;
          }),
      ),
    );
  }
});
