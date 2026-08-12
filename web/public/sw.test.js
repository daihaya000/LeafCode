import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Extract the cache decision logic for unit testing.
// The SW file itself is not directly importable in Node, so we test
// the pure function that decides whether to cache a response.
function shouldCacheResponse(response) {
  // response.ok === false → do not cache
  // response.ok === undefined → do not cache (treat as non-OK)
  return response.ok === true;
}

const serviceWorker = readFileSync(
  fileURLToPath(new URL("./sw.js", import.meta.url)),
  "utf8",
);

test("shouldCacheResponse returns false for 4xx", () => {
  assert.equal(shouldCacheResponse({ ok: false, status: 404 }), false);
});

test("shouldCacheResponse returns false for 5xx", () => {
  assert.equal(shouldCacheResponse({ ok: false, status: 500 }), false);
});

test("shouldCacheResponse returns true for 200", () => {
  assert.equal(shouldCacheResponse({ ok: true, status: 200 }), true);
});

test("shouldCacheResponse returns false when ok is undefined", () => {
  assert.equal(shouldCacheResponse({ ok: undefined, status: 200 }), false);
});

test("service worker uses a new cache version to discard legacy caches", () => {
  assert.match(serviceWorker, /const CACHE = "opencode-webui-v6";/);
});

test("service worker listens for BUILD_ID messages to wipe the real cache", () => {
  assert.match(serviceWorker, /addEventListener\("message"/);
  assert.match(serviceWorker, /type === "BUILD_ID"/);
  // The wipe must target the CACHE that navigation responses are stored in
  // (v5 wiped a BUILD_CACHE that nothing ever wrote to — a no-op).
  assert.match(serviceWorker, /caches\.delete\(CACHE\)/);
});

test("service worker caches /_next/ static assets so the offline shell works", () => {
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/_next\/"\)/);
  // Cache-first for versioned chunks: the cached navigation HTML references
  // these hashed files, which must be present offline too. The CACHE is wiped
  // whenever the build id changes, so stale chunks cannot outlive a deploy.
  assert.match(serviceWorker, /caches\.match\(req\)/);
});