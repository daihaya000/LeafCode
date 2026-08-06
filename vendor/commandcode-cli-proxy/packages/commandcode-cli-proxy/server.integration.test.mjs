// Integration coverage for the loopback HTTP server itself: spawns a fake
// `command-code` CLI (a tiny Node script reached via a PATH-resolved .cmd
// shim, to dodge Windows argv-quoting issues with spaces in absolute paths
// like "C:\Program Files\nodejs\node.exe") and drives real HTTP requests
// against it. This is what actually exercises the timeout/abort/stream
// wiring that unit tests on the pure helpers can't reach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";

function httpRequest(url, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

async function withFakeCliServer(fakeCliScript, testFn, { timeoutMs } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "commandcode-cli-test-"));
  const scriptPath = path.join(dir, "fake-cli.mjs");
  writeFileSync(scriptPath, fakeCliScript, "utf8");
  const cmdPath = path.join(dir, "command-code-test.cmd");
  // ASCII-only, CRLF: mirrors the repo's own .bat/.cmd encoding rule.
  writeFileSync(cmdPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`, "utf8");

  const prevPath = process.env.PATH;
  const prevCli = process.env.COMMANDCODE_CLI;
  const prevTimeout = process.env.COMMANDCODE_CLI_TIMEOUT_MS;
  process.env.PATH = `${dir}${path.delimiter}${prevPath}`;
  process.env.COMMANDCODE_CLI = "command-code-test.cmd";
  if (timeoutMs) process.env.COMMANDCODE_CLI_TIMEOUT_MS = String(timeoutMs);

  // Bust the module cache so each test gets its own `serverPromise` /
  // listening port instead of reusing a server bound with stale env vars.
  const mod = await import(`./index.mjs?t=${Date.now()}-${Math.random()}`);
  const server = await mod.start();
  const port = server.address().port;
  const baseURL = `http://127.0.0.1:${port}/v1`;

  try {
    await testFn({ baseURL });
  } finally {
    // A still-listening HTTP server keeps Node's event loop alive, so
    // `node --test` would never exit without this.
    await new Promise((resolve) => server.close(resolve));
    process.env.PATH = prevPath;
    if (prevCli === undefined) delete process.env.COMMANDCODE_CLI;
    else process.env.COMMANDCODE_CLI = prevCli;
    if (prevTimeout === undefined) delete process.env.COMMANDCODE_CLI_TIMEOUT_MS;
    else process.env.COMMANDCODE_CLI_TIMEOUT_MS = prevTimeout;
    // Best-effort cleanup; a lingering handle on Windows shouldn't fail the test.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // ignore
    }
  }
}

const SUCCESS_CLI = `
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", finalText: "hello from fake cli" }) + "\\n");
process.exit(0);
`;

test("non-streaming request returns finish_reason: stop", async () => {
  await withFakeCliServer(SUCCESS_CLI, async ({ baseURL }) => {
    const res = await httpRequest(`${baseURL}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "commandcode/deepseek/deepseek-v4-pro", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.choices[0].message.content, "hello from fake cli");
    assert.equal(parsed.choices[0].finish_reason, "stop");
  });
});

test("streaming request terminates with a finish_reason chunk before [DONE]", async () => {
  await withFakeCliServer(SUCCESS_CLI, async ({ baseURL }) => {
    const res = await httpRequest(`${baseURL}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "commandcode/deepseek/deepseek-v4-pro", messages: [{ role: "user", content: "hi" }], stream: true }),
    });
    assert.equal(res.status, 200);
    const events = res.body.trim().split("\n\n").filter(Boolean);
    assert.equal(events.at(-1), "data: [DONE]");
    const finishChunk = JSON.parse(events.at(-2).slice("data: ".length));
    assert.equal(finishChunk.choices[0].finish_reason, "stop");
  });
});

test("GET /v1/models lists the bundled models", async () => {
  await withFakeCliServer(SUCCESS_CLI, async ({ baseURL }) => {
    const res = await httpRequest(`${baseURL}/models`);
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.ok(parsed.data.some((m) => m.id === "deepseek/deepseek-v4-pro"));
  });
});

test("a hung CLI process is killed and surfaces a 502 instead of hanging the request forever", async () => {
  const HANGING_CLI = `setInterval(() => {}, 1000);`; // never exits, never prints
  await withFakeCliServer(HANGING_CLI, async ({ baseURL }) => {
    const started = Date.now();
    const res = await httpRequest(`${baseURL}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "commandcode/deepseek/deepseek-v4-pro", messages: [{ role: "user", content: "hi" }] }),
    });
    const elapsed = Date.now() - started;
    assert.equal(res.status, 502);
    assert.match(res.body, /timed out/i);
    // Should resolve close to the configured timeout, not hang indefinitely.
    assert.ok(elapsed < 5000, `expected timeout to fire quickly, took ${elapsed}ms`);
  }, { timeoutMs: 300 });
});

test("CLI exit failure surfaces the stderr message as a 502", async () => {
  const FAILING_CLI = `
process.stderr.write("boom: upstream rejected the request\\n");
process.exit(1);
`;
  await withFakeCliServer(FAILING_CLI, async ({ baseURL }) => {
    const res = await httpRequest(`${baseURL}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "commandcode/deepseek/deepseek-v4-pro", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(res.status, 502);
    assert.match(res.body, /boom: upstream rejected the request/);
  });
});
