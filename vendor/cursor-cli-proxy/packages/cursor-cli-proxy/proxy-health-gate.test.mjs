import { test } from "node:test";
import assert from "node:assert/strict";

const { createProxyHealthGate } = await import("./proxy-health-gate.mjs");

// setBaseURL marks the URL as already-validated (startup did the probe), so
// the first getOrRefresh within the throttle window does NOT probe. Tests use
// invalidate() to force a probe on the next call when they want to observe one.

test("throttle skips probe within window after a healthy probe", async () => {
  let clock = 1000;
  const calls = { probe: 0, rebind: 0 };
  const probe = async () => {
    calls.probe += 1;
    return true;
  };
  const rebind = async () => {
    calls.rebind += 1;
    return "http://127.0.0.1:32127/v1";
  };
  const gate = createProxyHealthGate({ probe, rebind, throttleMs: 1500, now: () => clock });
  gate.setBaseURL("http://127.0.0.1:32124/v1");
  gate.invalidate();

  const a = await gate.getOrRefresh(); // probe runs (invalidate forced it)
  assert.equal(a, "http://127.0.0.1:32124/v1");
  assert.equal(calls.probe, 1);

  const b = await gate.getOrRefresh(); // throttled, no probe
  assert.equal(b, "http://127.0.0.1:32124/v1");
  assert.equal(calls.probe, 1);

  clock += 1600; // past throttle window
  const c = await gate.getOrRefresh(); // probe runs again
  assert.equal(c, "http://127.0.0.1:32124/v1");
  assert.equal(calls.probe, 2);
  assert.equal(calls.rebind, 0);
});

test("probe ng triggers rebind and caches the new baseURL", async () => {
  let clock = 0;
  const calls = { probe: 0, rebind: 0 };
  const probe = async () => {
    calls.probe += 1;
    return false;
  };
  const rebind = async () => {
    calls.rebind += 1;
    return "http://127.0.0.1:32127/v1";
  };
  const gate = createProxyHealthGate({ probe, rebind, throttleMs: 1500, now: () => clock });
  gate.setBaseURL("http://127.0.0.1:32125/v1");
  gate.invalidate();

  const next = await gate.getOrRefresh();
  assert.equal(next, "http://127.0.0.1:32127/v1");
  assert.equal(calls.probe, 1);
  assert.equal(calls.rebind, 1);

  // After rebind the new baseURL is trusted within the throttle window: no probe.
  const again = await gate.getOrRefresh();
  assert.equal(again, "http://127.0.0.1:32127/v1");
  assert.equal(calls.probe, 1);
  assert.equal(calls.rebind, 1);
});

test("rebind throwing does not throw out of getOrRefresh and returns cached baseURL", async () => {
  let clock = 0;
  const probe = async () => false;
  const rebind = async () => {
    throw new Error("boom");
  };
  const gate = createProxyHealthGate({ probe, rebind, throttleMs: 1500, now: () => clock });
  gate.setBaseURL("http://127.0.0.1:32125/v1");
  gate.invalidate();

  const got = await gate.getOrRefresh();
  assert.equal(got, "http://127.0.0.1:32125/v1"); // cached retained, rebind failed
});

test("concurrent getOrRefresh rebinds exactly once (dedup)", async () => {
  let clock = 0;
  const calls = { probe: 0, rebind: 0 };
  let resolveRebind;
  const probe = async () => {
    calls.probe += 1;
    return false;
  };
  const rebind = async () => {
    calls.rebind += 1;
    await new Promise((r) => {
      resolveRebind = r;
    });
    return "http://127.0.0.1:32127/v1";
  };
  const gate = createProxyHealthGate({ probe, rebind, throttleMs: 10000, now: () => clock });
  gate.setBaseURL("http://127.0.0.1:32125/v1");
  gate.invalidate();

  const p1 = gate.getOrRefresh();
  const p2 = gate.getOrRefresh();
  const p3 = gate.getOrRefresh();
  // Let the in-flight probe resolve, then unblock the (single) rebind.
  await new Promise((r) => setImmediate(r));
  resolveRebind();

  const [a, b, c] = await Promise.all([p1, p2, p3]);
  assert.equal(a, "http://127.0.0.1:32127/v1");
  assert.equal(b, "http://127.0.0.1:32127/v1");
  assert.equal(c, "http://127.0.0.1:32127/v1");
  assert.equal(calls.rebind, 1, "rebind must run exactly once under concurrency");
  assert.ok(calls.probe >= 1 && calls.probe <= 3, `unexpected probe count ${calls.probe}`);
});

test("after throttle window expires, probe runs even when last known healthy", async () => {
  let clock = 5000;
  const calls = { probe: 0, rebind: 0 };
  const probe = async () => {
    calls.probe += 1;
    return true;
  };
  const rebind = async () => {
    calls.rebind += 1;
    return "http://127.0.0.1:32127/v1";
  };
  const gate = createProxyHealthGate({ probe, rebind, throttleMs: 1000, now: () => clock });
  gate.setBaseURL("http://127.0.0.1:32124/v1");
  gate.invalidate();

  await gate.getOrRefresh(); // probe 1
  clock += 500;
  await gate.getOrRefresh(); // throttled
  assert.equal(calls.probe, 1);
  clock += 600; // +1100 > 1000
  await gate.getOrRefresh(); // probe 2
  assert.equal(calls.probe, 2);
  assert.equal(calls.rebind, 0);
});

test("missing baseURL forces an initial rebind without probe", async () => {
  let clock = 0;
  const calls = { probe: 0, rebind: 0 };
  const probe = async () => {
    calls.probe += 1;
    return true;
  };
  const rebind = async () => {
    calls.rebind += 1;
    return "http://127.0.0.1:32127/v1";
  };
  const gate = createProxyHealthGate({ probe, rebind, throttleMs: 5000, now: () => clock });
  const got = await gate.getOrRefresh();
  assert.equal(got, "http://127.0.0.1:32127/v1");
  assert.equal(calls.rebind, 1);
  assert.equal(calls.probe, 0, "must not probe when there is no baseURL to probe");
});

test("setBaseURL after failure restores throttle-trusted healthy state", async () => {
  let clock = 0;
  const calls = { probe: 0, rebind: 0 };
  const probe = async () => {
    calls.probe += 1;
    return true;
  };
  const rebind = async () => {
    calls.rebind += 1;
    return "http://127.0.0.1:32124/v1";
  };
  const gate = createProxyHealthGate({ probe, rebind, throttleMs: 1000, now: () => clock });
  // Start with no URL -> rebind then we set explicit trusted URL.
  gate.setBaseURL("http://127.0.0.1:32124/v1");
  const r = await gate.getOrRefresh(); // trusted -> no probe
  assert.equal(r, "http://127.0.0.1:32124/v1");
  assert.equal(calls.probe, 0);
  assert.equal(calls.rebind, 0);
});

test("constructor validates required callbacks", () => {
  assert.throws(() => createProxyHealthGate({}), TypeError);
  assert.throws(() => createProxyHealthGate({ probe: () => true }), TypeError);
});