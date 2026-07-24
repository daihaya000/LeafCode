import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const source = readFileSync(join(repoRoot, "web", "public", "sw.js"), "utf8");

function loadWorker() {
  const events = new Map();
  const deleted = [];
  const context = {
    URL,
    Promise,
    caches: {
      keys: async () => ["opencode-webui-v2", "opencode-webui-v3", "unrelated-cache"],
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

test("service worker bypasses Next build assets instead of serving Cache Storage", () => {
  const { events } = loadWorker();
  let intercepted = false;
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
  assert.deepEqual(deleted, ["opencode-webui-v2", "unrelated-cache"]);
});
