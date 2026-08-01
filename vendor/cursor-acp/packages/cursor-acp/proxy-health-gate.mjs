// Per-request proxy health gate for cursor-acp.
//
// The cursor-acp plugin pins `proxyBaseURL` at startup (a Windows ghost
// listener on 32124/32125 can later make that dead) and `chat.params` keeps
// using the startup value for every request, so mid-session proxy death
// hangs every subsequent request. This module encapsulates the lazy
// "probe -> rebind" decision so it can be invoked per-request from the
// bundle, with throttle + in-flight dedup to keep per-request latency low
// and avoid thundering-herd rebinds.
//
// Pure logic: `probe`, `rebind`, and `now` are injected, so this is fully
// unit-testable without touching the network.

export function createProxyHealthGate({
  probe,
  rebind,
  throttleMs = 1500,
  now = Date.now,
} = {}) {
  if (typeof probe !== "function") {
    throw new TypeError("createProxyHealthGate: probe must be a function");
  }
  if (typeof rebind !== "function") {
    throw new TypeError("createProxyHealthGate: rebind must be a function");
  }

  let baseURL = "";
  let lastCheckAt = 0;
  let lastKnownHealthy = false;
  let inFlight = null;

  function setBaseURL(value) {
    baseURL = typeof value === "string" ? value : "";
    lastKnownHealthy = baseURL.length > 0;
    lastCheckAt = now();
  }

  function invalidate() {
    lastKnownHealthy = false;
  }

  async function rebindAndCache(reason) {
    const next = await rebind();
    baseURL = typeof next === "string" ? next : baseURL;
    lastCheckAt = now();
    // If rebind returned a non-string or empty, keep lastKnownHealthy=false so
    // we re-probe after throttle instead of trusting a bad value.
    lastKnownHealthy = typeof next === "string" && next.length > 0;
    return baseURL;
  }

  async function getOrRefresh() {
    if (inFlight) {
      try {
        await inFlight;
      } catch {
        // swallow; we still return whatever cached baseURL we have
      }
      return baseURL;
    }

    // No baseURL yet (e.g. called before setBaseURL): force a rebind.
    const needsRebind = baseURL.length === 0;

    // Throttle: skip probe when we recently confirmed health.
    const withinThrottle =
      lastKnownHealthy && now() - lastCheckAt < throttleMs;

    if (!needsRebind && withinThrottle) {
      return baseURL;
    }

    inFlight = (async () => {
      if (needsRebind) {
        await rebindAndCache("initial").catch(() => {
          lastKnownHealthy = false;
          lastCheckAt = now();
        });
        return;
      }
      let ok = false;
      try {
        ok = await probe(baseURL);
      } catch {
        ok = false;
      }
      if (ok) {
        lastCheckAt = now();
        lastKnownHealthy = true;
        return;
      }
      await rebindAndCache("unhealthy").catch(() => {
        lastKnownHealthy = false;
        lastCheckAt = now();
      });
    })();

    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    return baseURL;
  }

  return {
    setBaseURL,
    getOrRefresh,
    invalidate,
  };
}