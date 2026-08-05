// OpenCode WebUI service worker: offline app shell + static asset caching.
// Never touches /api/* (BFF proxy + SSE streams) so live data stays live.

// v5: build-id aware cache invalidation. The page sends its BUILD_COMMIT via
// postMessage on load; when the SW sees a different build id it wipes the
// navigation cache so a stale cached "/" (referencing deleted _next chunks)
// can never render as a white screen after a deploy.
const CACHE = "opencode-webui-v5";
const BUILD_CACHE = "opencode-webui-build";
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

async function wipeBuildCache() {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((k) => k === BUILD_CACHE).map((k) => caches.delete(k)),
  );
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
      event.waitUntil(
        wipeBuildCache().then(() => {
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
  // Next build assets are versioned per deployment. Never serve an old chunk
  // from Cache Storage after a new build has replaced web/.next.
  if (url.pathname.startsWith("/_next/")) return;

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

  // Static assets: cache-first, populate on miss (except /_next above).
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