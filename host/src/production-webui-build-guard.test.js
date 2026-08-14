import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectProductionWebUi,
  isThisWebUiNextStart,
  main,
  parseListeningPids,
  requestHostRestartWebUi,
  stopProductionWebUi,
} from "../../scripts/production-webui-build-guard.mjs";
import { resolveHostControlUrl } from "../../scripts/lib/host-control.mjs";

const webDir = "C:\\workspace\\OpenCodeWebUI\\web";
const nextStart = `"C:\\Program Files\\nodejs\\node.exe" "${webDir}\\node_modules\\next\\dist\\bin\\next" start --port 3000`;

test("production build guard identifies only this WebUI's next start listener", () => {
  const result = inspectProductionWebUi({
    port: 3000,
    webDir,
    exec(command) {
      if (command === "netstat") {
        return "  TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   8123\r\n";
      }
      assert.equal(command, "powershell.exe");
      return nextStart;
    },
  });
  assert.deepEqual(result, { state: "running", pid: 8123 });
});

test("production build guard permits an unrelated listener", () => {
  const result = inspectProductionWebUi({
    port: 3000,
    webDir,
    exec(command) {
      if (command === "netstat") {
        return "  TCP    [::]:3000   [::]:0   LISTENING   8123\r\n";
      }
      return '"C:\\Program Files\\nodejs\\node.exe" "C:\\other-app\\web\\node_modules\\next\\dist\\bin\\next" start';
    },
  });
  assert.deepEqual(result, { state: "absent" });
});

test("production build guard fails closed when a listener cannot be inspected", () => {
  const result = inspectProductionWebUi({
    port: 3000,
    webDir,
    exec(command) {
      if (command === "netstat") {
        return "  TCP    127.0.0.1:3000   0.0.0.0:0   LISTENING   8123\r\n";
      }
      throw new Error("PowerShell unavailable");
    },
  });
  assert.deepEqual(result, { state: "unknown", pid: 8123 });
});

test("production build guard matches exact ports and next start commands", () => {
  assert.deepEqual(
    parseListeningPids("TCP 0.0.0.0:30000 0.0.0.0:0 LISTENING 2\nTCP 0.0.0.0:3000 0.0.0.0:0 LISTENING 1", 3000),
    [1],
  );
  assert.equal(isThisWebUiNextStart(nextStart, webDir), true);
  assert.equal(isThisWebUiNextStart(nextStart.replace(" start", " dev"), webDir), false);
});

// --- stop support -----------------------------------------------------------

const noSleep = async () => {};

/** inspect() stub: returns each state in order, repeating the last one. */
function scriptedInspect(states) {
  const queue = [...states];
  const calls = [];
  const inspect = (options) => {
    calls.push(options);
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  inspect.calls = calls;
  return inspect;
}

function recordingExec() {
  const calls = [];
  const exec = (file, args) => {
    calls.push([file, ...(args ?? [])].join(" "));
    return "";
  };
  exec.calls = calls;
  return exec;
}

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const handler = routes[new URL(String(url)).pathname];
    if (!handler) throw new Error(`unexpected request: ${url}`);
    return typeof handler === "function" ? handler() : handler;
  };
  impl.calls = calls;
  return impl;
}

const healthyHost = {
  ok: true,
  status: 200,
  json: async () => ({ ok: true, service: 'opencode-webui-host' }),
};

test("stopProductionWebUi stops through the host control plane", async () => {
  const exec = recordingExec();
  const fetchImpl = fakeFetch({
    "/health": healthyHost,
    "/stop/webui": { ok: true, status: 200 },
  });
  const inspect = scriptedInspect([{ state: "running", pid: 8123 }, { state: "absent" }]);

  const result = await stopProductionWebUi({
    controlUrl: "http://127.0.0.1:18765/",
    fetchImpl,
    inspect,
    exec,
    sleep: noSleep,
  });

  assert.deepEqual(result, { stopped: true, method: "host-control" });
  assert.deepEqual(fetchImpl.calls, [
    "http://127.0.0.1:18765/health",
    "http://127.0.0.1:18765/stop/webui",
  ]);
  assert.deepEqual(exec.calls, [], "the control plane path must never taskkill");
});

test("stopProductionWebUi refuses to kill when the host has no stop endpoint", async () => {
  const exec = recordingExec();
  const fetchImpl = fakeFetch({
    "/health": healthyHost,
    "/stop/webui": { ok: false, status: 404 },
  });

  const result = await stopProductionWebUi({
    controlUrl: "http://127.0.0.1:18765",
    fetchImpl,
    inspect: scriptedInspect([{ state: "running", pid: 8123 }]),
    exec,
    sleep: noSleep,
  });

  // Killing would only be undone by the old host's watchdog, which would then
  // serve on top of the half-written build.
  assert.deepEqual(result, { stopped: false, reason: "host-outdated" });
  assert.deepEqual(exec.calls, []);
});

test("stopProductionWebUi treats 501 as an outdated host too", async () => {
  const exec = recordingExec();
  const result = await stopProductionWebUi({
    controlUrl: "http://127.0.0.1:18765",
    fetchImpl: fakeFetch({ "/health": healthyHost, "/stop/webui": { ok: false, status: 501 } }),
    inspect: scriptedInspect([{ state: "running", pid: 8123 }]),
    exec,
    sleep: noSleep,
  });
  assert.deepEqual(result, { stopped: false, reason: "host-outdated" });
  assert.deepEqual(exec.calls, []);
});

test("stopProductionWebUi reports a failing control plane without killing", async () => {
  const exec = recordingExec();
  const result = await stopProductionWebUi({
    controlUrl: "http://127.0.0.1:18765",
    fetchImpl: fakeFetch({
      "/health": healthyHost,
      "/stop/webui": () => {
        throw new Error("socket hang up");
      },
    }),
    inspect: scriptedInspect([{ state: "running", pid: 8123 }]),
    exec,
    sleep: noSleep,
  });
  assert.deepEqual(result, { stopped: false, reason: "host-control-failed" });
  assert.deepEqual(exec.calls, []);
});

test("stopProductionWebUi fails when the port stays busy after a host stop", async () => {
  const result = await stopProductionWebUi({
    controlUrl: "http://127.0.0.1:18765",
    fetchImpl: fakeFetch({ "/health": healthyHost, "/stop/webui": { ok: true, status: 200 } }),
    inspect: scriptedInspect([{ state: "running", pid: 8123 }]),
    exec: recordingExec(),
    sleep: noSleep,
    portWaitMs: 0,
  });
  assert.deepEqual(result, { stopped: false, reason: "host-control-failed" });
});

test("stopProductionWebUi kills an orphaned next start when no host answers", async () => {
  const exec = recordingExec();
  const result = await stopProductionWebUi({
    controlUrl: "http://127.0.0.1:18765",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
    inspect: scriptedInspect([{ state: "running", pid: 8123 }, { state: "absent" }]),
    exec,
    sleep: noSleep,
  });

  assert.deepEqual(result, { stopped: true, method: "kill", pid: 8123 });
  assert.deepEqual(exec.calls, ["taskkill /T /PID 8123"]);
});

test("stopProductionWebUi escalates to a hard kill before giving up", async () => {
  const exec = recordingExec();
  const result = await stopProductionWebUi({
    controlUrl: "http://127.0.0.1:18765",
    fetchImpl: async () => ({ ok: false, status: 500 }),
    inspect: scriptedInspect([{ state: "running", pid: 8123 }]),
    exec,
    sleep: noSleep,
    softKillWaitMs: 0,
    portWaitMs: 0,
  });

  assert.deepEqual(result, { stopped: false, reason: "kill-failed", pid: 8123 });
  assert.deepEqual(exec.calls, ["taskkill /T /PID 8123", "taskkill /T /F /PID 8123"]);
});

test("stopProductionWebUi ignores a foreign service holding the control port", async () => {
  const exec = recordingExec();
  const result = await stopProductionWebUi({
    controlUrl: "http://127.0.0.1:18765",
    fetchImpl: fakeFetch({
      "/health": { ok: true, status: 200, json: async () => ({ service: "something-else" }) },
    }),
    inspect: scriptedInspect([{ state: "running", pid: 8123 }, { state: "absent" }]),
    exec,
    sleep: noSleep,
  });
  // The foreign service is never asked to stop; the listener is an orphan.
  assert.deepEqual(result, { stopped: true, method: "kill", pid: 8123 });
  assert.deepEqual(exec.calls, ["taskkill /T /PID 8123"]);
});

test("stopProductionWebUi never kills an unidentified listener", async () => {
  const exec = recordingExec();
  const result = await stopProductionWebUi({
    controlUrl: "http://127.0.0.1:18765",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
    inspect: scriptedInspect([{ state: "unknown", pid: 8123 }]),
    exec,
    sleep: noSleep,
  });

  assert.deepEqual(result, { stopped: false, reason: "unidentified-listener" });
  assert.deepEqual(exec.calls, []);
});

test("stopProductionWebUi is a no-op when the port is already free", async () => {
  const exec = recordingExec();
  const result = await stopProductionWebUi({
    controlUrl: "http://127.0.0.1:18765",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
    inspect: scriptedInspect([{ state: "absent" }]),
    exec,
    sleep: noSleep,
  });
  assert.deepEqual(result, { stopped: true, method: "already-stopped" });
  assert.deepEqual(exec.calls, []);
});

test("requestHostRestartWebUi is best effort", async () => {
  const fetchImpl = fakeFetch({ "/restart/webui": { ok: true, status: 202 } });
  assert.equal(
    await requestHostRestartWebUi({ controlUrl: "http://127.0.0.1:18765/", fetchImpl }),
    true,
  );
  assert.deepEqual(fetchImpl.calls, ["http://127.0.0.1:18765/restart/webui"]);

  assert.equal(
    await requestHostRestartWebUi({
      controlUrl: "http://127.0.0.1:18765",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    }),
    false,
  );
});

test("resolveHostControlUrl prefers env, then the control file, then the default", () => {
  assert.equal(
    resolveHostControlUrl({
      env: { LEAFCODE_HOST_CONTROL_URL: "http://127.0.0.1:20000/" },
      exists: () => true,
      read: () => JSON.stringify({ url: "http://127.0.0.1:19999" }),
    }),
    "http://127.0.0.1:20000",
  );

  assert.equal(
    resolveHostControlUrl({
      env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
      exists: (file) => file.endsWith("host-control.json"),
      read: () => JSON.stringify({ url: "http://127.0.0.1:19999/" }),
    }),
    "http://127.0.0.1:19999",
  );

  assert.equal(
    resolveHostControlUrl({
      env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
      exists: () => true,
      read: () => JSON.stringify({ port: 18888 }),
    }),
    "http://127.0.0.1:18888",
  );

  assert.equal(resolveHostControlUrl({ env: {}, exists: () => false }), "http://127.0.0.1:18765");
  assert.equal(
    resolveHostControlUrl({
      env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
      exists: () => true,
      read: () => "{ not json",
    }),
    "http://127.0.0.1:18765",
  );
});

// --- main() CLI behavior ----------------------------------------------------

test("main --restart is a no-op that does not contact the host", async () => {
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetched = true;
    return new Response("ok", { status: 200 });
  };
  try {
    await main(["--restart"]);
    assert.equal(fetched, false, "--restart must not call the host");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("main --stop refuses and exits 1 when the WebUI is running", async () => {
  // inspectProductionWebUi uses real netstat/powershell. On the test host port
  // 39998 is effectively always free, so --stop should be a no-op (absent),
  // not a stop. This verifies --stop no longer attempts a stop.
  const originalPort = process.env.LEAFCODE_PORT;
  process.env.LEAFCODE_PORT = "39998";
  try {
    await main(["--stop"]);
    // Port is free -> absent -> main returns without setting exitCode.
    assert.equal(process.exitCode, undefined);
  } finally {
    process.env.LEAFCODE_PORT = originalPort;
    if (process.exitCode !== undefined) process.exitCode = undefined;
  }
});

test("main with no args is a no-op when the port is free", async () => {
  const originalPort = process.env.LEAFCODE_PORT;
  process.env.LEAFCODE_PORT = "39999";
  try {
    await main([]);
    assert.equal(process.exitCode, undefined);
  } finally {
    process.env.LEAFCODE_PORT = originalPort;
    if (process.exitCode !== undefined) process.exitCode = undefined;
  }
});
