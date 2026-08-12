import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const source = readFileSync(join(repoRoot, "web", "public", "sw.js"), "utf8");
// Read the active cache name from sw.js so a version bump does not break the
// test: only the caches that are *not* the current one must be deleted.
const currentCache = /const CACHE = "([^"]+)"/.exec(source)?.[1];
const staleCaches = ["opencode-webui-v1", "unrelated-cache"];

function loadWorker() {
  const events = new Map();
  const deleted = [];
  const context = {
    URL,
    Promise,
    // Network fallback stub so cache-miss handlers settle instead of
    // producing unhandled rejections.
    fetch: async () => ({ ok: false }),
    caches: {
      keys: async () => [staleCaches[0], currentCache, staleCaches[1]],
      delete: async (name) => {
        deleted.push(name);
        return true;
      },
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      match: async () => undefined,
    },
    self: {
      location: { origin: "https://webui.test" },
      addEventListener(type, handler) {
        events.set(type, handler);
      },
      skipWaiting() {},
      clients: { claim() {} },
    },
  };
  vm.runInNewContext(source, context, { filename: "sw.js" });
  return { events, deleted };
}

test("service worker serves Next build assets through Cache Storage (offline shell)", () => {
  const { events } = loadWorker();
  let intercepted = false;
  // fetch is exercised only as the network fallback after a cache miss; the
  // vm context must provide it so the handler does not crash.
  events.get("fetch")({
    request: {
      method: "GET",
      mode: "cors",
      url: "https://webui.test/_next/static/chunks/8043.js",
    },
    respondWith() {
      intercepted = true;
    },
  });
  assert.equal(intercepted, true);
});

test("service worker bypasses BFF/API calls entirely", () => {
  const { events } = loadWorker();
  let intercepted = false;
  events.get("fetch")({
    request: {
      method: "GET",
      mode: "cors",
      url: "https://webui.test/api/tasks",
    },
    respondWith() {
      intercepted = true;
    },
  });
  assert.equal(intercepted, false);
});

test("service worker cache version removes the previous Next asset cache on activation", async () => {
  const { events, deleted } = loadWorker();
  let activation;
  events.get("activate")({
    waitUntil(promise) {
      activation = promise;
    },
  });
  await activation;
  assert.ok(currentCache, "sw.js must declare a CACHE name");
  assert.deepEqual(deleted, staleCaches);
});
