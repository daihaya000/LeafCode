import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectProductionWebUi,
  isThisWebUiNextStart,
  parseListeningPids,
} from "../../scripts/production-webui-build-guard.mjs";

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
