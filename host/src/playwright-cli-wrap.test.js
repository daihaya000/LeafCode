import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createControlRequestHandler, matchControlRoute } from "./control-server.js";
import {
  parsePlaywrightCliRequest,
  playwrightCliWrapDir,
  prependPlaywrightCliWrapPath,
  resolvePlaywrightCliJs,
  runPlaywrightCliProcess,
  runViaHost,
  runWrappedCli,
} from "../../scripts/lib/playwright-cli-wrap.mjs";
import { EventEmitter } from "node:events";

test("parsePlaywrightCliRequest accepts string argv and cwd", () => {
  assert.deepEqual(parsePlaywrightCliRequest({ argv: ["open", "https://example.com"], cwd: "C:\\repo" }), {
    argv: ["open", "https://example.com"],
    cwd: "C:\\repo",
  });
});

test("parsePlaywrightCliRequest rejects unsafe bodies", () => {
  assert.equal(parsePlaywrightCliRequest(null).error, "body must be an object");
  assert.equal(parsePlaywrightCliRequest({ argv: "open" }).error, "argv must be an array");
  assert.equal(parsePlaywrightCliRequest({ argv: [1], cwd: "x" }).error, "args must be strings");
  assert.equal(parsePlaywrightCliRequest({ argv: ["a\0b"], cwd: "x" }).error, "arg contains NUL");
  assert.equal(parsePlaywrightCliRequest({ argv: ["open"] }).error, "cwd required");
});

test("prependPlaywrightCliWrapPath puts the shim first once", () => {
  const env = prependPlaywrightCliWrapPath(
    { PATH: "C:\\Windows;C:\\npm" },
    "C:\\LeafCode",
    "win32",
  );
  assert.equal(env.LEAFCODE_PLAYWRIGHT_CLI_WRAP, "1");
  assert.equal(env.PATH, `${playwrightCliWrapDir("C:\\LeafCode")};C:\\Windows;C:\\npm`);
  const again = prependPlaywrightCliWrapPath(env, "C:\\LeafCode", "win32");
  assert.equal(again.PATH, env.PATH);
});

test("resolvePlaywrightCliJs uses PLAYWRIGHT_CLI_JS and never PATH", () => {
  const fake = "C:\\tools\\playwright-cli.js";
  assert.equal(
    resolvePlaywrightCliJs({ PLAYWRIGHT_CLI_JS: fake }, (p) => p === fake),
    fake,
  );
  assert.throws(
    () => resolvePlaywrightCliJs({ PLAYWRIGHT_CLI_JS: fake, PATH: "C:\\evil" }, () => false),
    /not found/,
  );
});

test("runPlaywrightCliProcess returns on exit while a detached grandchild lives", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pw-wrap-"));
  const pidFile = join(dir, "child.pid");
  const fake = join(dir, "fake.mjs");
  writeFileSync(
    fake,
    `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 8000)"], { detached: true, stdio: "ignore" });
writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
child.unref();
process.stdout.write("parent done\\n");
process.exit(0);
`,
  );
  const t0 = Date.now();
  const result = await runPlaywrightCliProcess({
    cliJs: fake,
    argv: [],
    cwd: tmpdir(),
    timeoutMs: 5_000,
  });
  const ms = Date.now() - t0;
  assert.equal(result.code, 0);
  assert.match(result.stdout, /parent done/);
  assert.ok(ms < 2000, `expected exit in <2s, took ${ms}ms`);
  let grandchildPid = 0;
  try {
    grandchildPid = Number(readFileSync(pidFile, "utf8"));
  } catch {
    grandchildPid = 0;
  }
  if (grandchildPid) {
    try {
      process.kill(grandchildPid);
    } catch {
      /* already gone */
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may keep the directory until the detached grandchild drops its cwd.
  }
});

test("runViaHost posts argv to the host control path", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, code: 0, stdout: "ok\n", stderr: "" }),
    };
  };
  const result = await runViaHost({
    argv: ["open"],
    cwd: "C:\\repo",
    controlUrl: "http://127.0.0.1:18765",
    fetchFn,
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "ok\n");
  assert.equal(calls[0].url, "http://127.0.0.1:18765/playwright-cli");
  assert.equal(JSON.parse(calls[0].init.body).argv[0], "open");
});

test("runWrappedCli on Windows uses the host relay and does not spawn", async () => {
  const chunks = [];
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, code: 0, stdout: "relayed\n", stderr: "" }),
  });
  const code = await runWrappedCli({
    argv: ["snapshot"],
    cwd: "C:\\repo",
    env: { LEAFCODE_HOST_CONTROL_URL: "http://127.0.0.1:18765" },
    stdout: { write: (c) => chunks.push(c) },
    stderr: { write: () => {} },
    fetchFn,
    platform: "win32",
    spawnFn: () => {
      throw new Error("must not spawn on Windows");
    },
  });
  assert.equal(code, 0);
  assert.equal(chunks.join(""), "relayed\n");
});

test("runWrappedCli on Windows fails closed when the host is down", async () => {
  const err = [];
  const code = await runWrappedCli({
    argv: ["open"],
    cwd: "C:\\repo",
    env: { LEAFCODE_HOST_CONTROL_URL: "http://127.0.0.1:9" },
    stdout: { write: () => {} },
    stderr: { write: (c) => err.push(c) },
    fetchFn: async () => {
      throw new Error("ECONNREFUSED");
    },
    platform: "win32",
  });
  assert.equal(code, 1);
  assert.match(err.join(""), /host relay failed/);
});

test("matchControlRoute maps POST /playwright-cli", () => {
  assert.equal(matchControlRoute("POST", "/playwright-cli"), "playwright-cli");
  assert.equal(matchControlRoute("POST", "/playwright-cli/"), "playwright-cli");
  assert.equal(matchControlRoute("GET", "/playwright-cli"), null);
});

class MockReadable extends EventEmitter {
  constructor(body = "", headers = {}) {
    super();
    this.body = Buffer.from(body);
    this.headers = { host: "127.0.0.1:18765", ...headers };
    this.method = "POST";
    this.url = "/playwright-cli";
  }
  on(event, listener) {
    super.on(event, listener);
    if (event === "data") setImmediate(() => listener(this.body));
    if (event === "end") setImmediate(() => listener());
    return this;
  }
}

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null;
    },
  };
}

test("POST /playwright-cli reports 501 without a handler", async () => {
  const handle = createControlRequestHandler({
    onRestartWebui: () => {},
    onRestartOpencode: () => {},
    onRestartAll: () => {},
  });
  const res = fakeResponse();
  await handle(new MockReadable("{}"), res);
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.ok, false);
});

test("POST /playwright-cli returns handler stdout", async () => {
  const handle = createControlRequestHandler({
    onRestartWebui: () => {},
    onRestartOpencode: () => {},
    onRestartAll: () => {},
    onPlaywrightCli: async (body) => {
      assert.deepEqual(body.argv, ["open"]);
      return { code: 0, stdout: "opened\n", stderr: "" };
    },
  });
  const res = fakeResponse();
  await handle(
    new MockReadable(JSON.stringify({ argv: ["open"], cwd: "C:\\repo" })),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.stdout, "opened\n");
});

test("POST /playwright-cli forwards handler validation errors as 400", async () => {
  const handle = createControlRequestHandler({
    onRestartWebui: () => {},
    onRestartOpencode: () => {},
    onRestartAll: () => {},
    onPlaywrightCli: async () => ({ ok: false, status: 400, error: "cwd is not a directory" }),
  });
  const res = fakeResponse();
  await handle(new MockReadable(JSON.stringify({ argv: [], cwd: "missing" })), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "cwd is not a directory");
});
