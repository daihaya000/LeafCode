import assert from "node:assert/strict";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const setupSource = join(repoRoot, "setup.bat");
const isWindows = process.platform === "win32";

function writeBat(path, contents) {
  const normalized = contents.replace(/\r?\n/g, "\r\n");
  writeFileSync(path, `@echo off\r\n${normalized}\r\n`, "utf8");
}

function createSandbox(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "OpenCodeWebUI-setup-"));
  const bin = join(root, "mock-bin");
  const log = join(root, "commands.log");
  mkdirSync(bin);
  mkdirSync(join(root, "web"));
  mkdirSync(join(root, "host"));
  writeFileSync(join(root, "setup.bat"), readFileSync(setupSource));
  writeBat(join(root, "start-webui.bat"), options.asyncStart
    ? 'type nul > "%~dp0started.txt"\nping -n 15 127.0.0.1 >nul\ntype nul > "%~dp0finished.txt"\ntype nul > "%~dp0exited.txt"\ncd /d "%TEMP%"\nexit /b 0'
    : 'type nul > "%~dp0started.txt"\nexit /b 0');
  writeBat(join(bin, "where.cmd"), [
    'if exist "%~dp0%~1.cmd" echo %~dp0%~1.cmd',
    'if exist "%~dp0%~1.cmd" exit /b 0',
    "exit /b 1",
  ].join("\n"));

  if (options.withWinget !== false) {
    writeBat(join(bin, "winget.cmd"), [
      'echo %*>>"%SETUP_TEST_LOG%"',
      'if not "%~1"=="install" exit /b 87',
      'if not "%~2"=="--id" exit /b 87',
      'if "%~3"=="OpenJS.NodeJS.LTS" goto :node',
      'if "%~3"=="SST.opencode" goto :opencode',
      "exit /b 87",
      ":node",
      'if not "%SETUP_TEST_WINGET_NODE_EXIT%"=="0" exit /b %SETUP_TEST_WINGET_NODE_EXIT%',
      'type nul > "%SETUP_TEST_ROOT%\\node-installed"',
      "exit /b 0",
      ":opencode",
      'if not "%SETUP_TEST_WINGET_OPENCODE_EXIT%"=="0" exit /b %SETUP_TEST_WINGET_OPENCODE_EXIT%',
      'if "%SETUP_TEST_OPENCODE_WINGET_MARKER%"=="1" type nul > "%SETUP_TEST_ROOT%\\opencode-winget-installed"',
      "exit /b 0",
    ].join("\n"));
  }

  if (options.withNode !== false) {
    writeBat(join(bin, "node.cmd"), [
      'if "%~1"=="scripts\\production-webui-build-guard.mjs" exit /b %SETUP_TEST_GUARD_EXIT%',
      'if not "%~1"=="-p" exit /b 0',
      'if exist "%SETUP_TEST_ROOT%\\node-installed" echo %SETUP_TEST_NODE_MAJOR_AFTER_INSTALL%',
      'if exist "%SETUP_TEST_ROOT%\\node-installed" exit /b 0',
      "echo %SETUP_TEST_NODE_MAJOR%",
      "exit /b 0",
    ].join("\n"));
  }

  writeBat(join(bin, "opencode.cmd"), [
    'if exist "%SETUP_TEST_ROOT%\\opencode-winget-installed" exit /b 0',
    'if exist "%SETUP_TEST_ROOT%\\opencode-npm-installed" exit /b 0',
    "exit /b %SETUP_TEST_OPENCODE_EXIT%",
  ].join("\n"));
  writeBat(join(bin, "npm.cmd"), [
    'echo npm %CD% %*>>"%SETUP_TEST_LOG%"',
    'if "%~1"=="install" if "%~2"=="-g" goto :global',
    'if /i "%CD:~-4%"=="\\web" if "%~1"=="ci" exit /b %SETUP_TEST_NPM_WEB_CI_EXIT%',
    'if /i "%CD:~-4%"=="\\web" if "%~1"=="run" if "%~2"=="build" goto :build',
    'if /i "%CD:~-5%"=="\\host" if "%~1"=="ci" exit /b %SETUP_TEST_NPM_HOST_CI_EXIT%',
    "exit /b 0",
    ":global",
    'if not "%SETUP_TEST_NPM_GLOBAL_EXIT%"=="0" exit /b %SETUP_TEST_NPM_GLOBAL_EXIT%',
    'type nul > "%SETUP_TEST_ROOT%\\opencode-npm-installed"',
    "exit /b 0",
    ":build",
    'if not "%SETUP_TEST_NPM_WEB_BUILD_EXIT%"=="0" exit /b %SETUP_TEST_NPM_WEB_BUILD_EXIT%',
    'if "%SETUP_TEST_CREATE_BUILD_ID%"=="0" exit /b 0',
    "mkdir .next 2>nul",
    "> .next\\BUILD_ID echo setup-test-build",
    "exit /b 0",
  ].join("\n"));

  const env = {
    ...process.env,
    PATH: `${bin};${join(process.env.SystemRoot ?? "C:\\Windows", "System32")}`,
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    SETUP_NONINTERACTIVE: "1",
    SETUP_TEST_ROOT: root,
    SETUP_TEST_LOG: log,
    SETUP_TEST_NODE_MAJOR: String(options.nodeMajor ?? 22),
    SETUP_TEST_NODE_MAJOR_AFTER_INSTALL: String(options.nodeMajorAfterInstall ?? 22),
    SETUP_TEST_WINGET_NODE_EXIT: String(options.wingetNodeExit ?? 0),
    SETUP_TEST_WINGET_OPENCODE_EXIT: String(options.wingetOpenCodeExit ?? 0),
    SETUP_TEST_OPENCODE_WINGET_MARKER: options.opencodeWingetMarker === false ? "0" : "1",
    SETUP_TEST_OPENCODE_EXIT: String(options.opencodeExit ?? 0),
    SETUP_TEST_NPM_GLOBAL_EXIT: String(options.npmGlobalExit ?? 0),
    SETUP_TEST_NPM_WEB_CI_EXIT: String(options.npmWebCiExit ?? 0),
    SETUP_TEST_NPM_WEB_BUILD_EXIT: String(options.npmWebBuildExit ?? 0),
    SETUP_TEST_NPM_HOST_CI_EXIT: String(options.npmHostCiExit ?? 0),
    SETUP_TEST_CREATE_BUILD_ID: options.createBuildId === false ? "0" : "1",
    SETUP_TEST_GUARD_EXIT: String(options.guardExit ?? 0),
  };
  return {
    root,
    log,
    run({ captureOutput = true, timeout = 30_000 } = {}) {
      const startedAt = Date.now();
      const outFile = join(root, "stdout.txt");
      const errFile = join(root, "stderr.txt");
      const wrapper = join(root, "_run.bat");
      if (captureOutput) {
        writeFileSync(wrapper, `@echo off\r\ncall setup.bat >"${outFile}" 2>"${errFile}"\r\n`, "utf8");
      } else {
        writeFileSync(wrapper, "@echo off\r\ncall setup.bat\r\n", "utf8");
      }
      const result = spawnSync(process.env.ComSpec ?? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), ["/d", "/c", "call _run.bat"], {
        cwd: root, encoding: "utf8", env, timeout, windowsHide: true,
        stdio: "ignore",
      });
      if (captureOutput) {
        result.stdout = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
        result.stderr = existsSync(errFile) ? readFileSync(errFile, "utf8") : "";
      }
      return { ...result, elapsedMs: Date.now() - startedAt };
    },
    cleanup() {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch (error) {
        if (error.code !== "EPERM") throw error;
      }
    },
  };
}

function assertCompleted(result, label) {
  assert.equal(result.error, undefined, `${label}: ${result.error?.message ?? "spawn failed"}`);
  assert.equal(result.signal, null, `${label}: child was terminated by ${result.signal}`);
}

async function waitFor(path, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.fail(`Timed out waiting for ${basename(path)}`);
}

test("setup.bat uses successful winget installs, builds, and starts separately", { skip: !isWindows }, async () => {
  const sandbox = createSandbox({ nodeMajor: 18, nodeMajorAfterInstall: 22, opencodeExit: 1 });
  try {
    const result = sandbox.run();
    assertCompleted(result, "winget success");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(join(sandbox.root, "opencode-winget-installed")), true);
    assert.equal(existsSync(join(sandbox.root, "opencode-npm-installed")), false);
    assert.equal(existsSync(join(sandbox.root, "web", ".next", "BUILD_ID")), true);
    await waitFor(join(sandbox.root, "started.txt"));
    const log = readFileSync(sandbox.log, "utf8");
    assert.match(log, /install --id OpenJS\.NodeJS\.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity/);
    assert.match(log, /install --id SST\.opencode --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity/);
    assert.doesNotMatch(log, /npm .* install -g opencode-ai/);
  } finally { sandbox.cleanup(); }
});

test("setup.bat starts the host asynchronously", { skip: !isWindows }, async () => {
  const sandbox = createSandbox({ asyncStart: true });
  try {
    const result = sandbox.run({ captureOutput: false });
    assertCompleted(result, "asynchronous host start");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(result.elapsedMs < 2_000, `setup waited ${result.elapsedMs}ms for the host child`);
    await waitFor(join(sandbox.root, "started.txt"));
    assert.equal(existsSync(join(sandbox.root, "finished.txt")), false);
    await waitFor(join(sandbox.root, "finished.txt"), 500);
    await waitFor(join(sandbox.root, "exited.txt"), 500);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  } finally { sandbox.cleanup(); }
});

test("setup.bat falls back to npm only after the OpenCode winget install fails", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ opencodeExit: 1, wingetOpenCodeExit: 1 });
  try {
    const result = sandbox.run();
    assertCompleted(result, "npm fallback");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(join(sandbox.root, "opencode-winget-installed")), false);
    assert.equal(existsSync(join(sandbox.root, "opencode-npm-installed")), true);
    assert.match(readFileSync(sandbox.log, "utf8"), /npm .* install -g opencode-ai/);
  } finally { sandbox.cleanup(); }
});

test("setup.bat uses non-blocking start and reaches the success message", { skip: !isWindows }, async () => {
  const sandbox = createSandbox({ asyncStart: true });
  try {
    const result = sandbox.run();
    assertCompleted(result, "non-blocking start");
    assert.equal(result.status, 0);
    // success message must be reached (exit /b 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /セットアップが完了しました/);
    // start-webui.bat must be invoked via `start` (non-blocking)
    await waitFor(join(sandbox.root, "started.txt"));
    // setup.bat must NOT wait for the host to finish
    assert.equal(existsSync(join(sandbox.root, "finished.txt")), false);
  } finally { sandbox.cleanup(); }
});

test("setup.bat reaches exit /b 0 with BUILD_ID present", { skip: !isWindows }, () => {
  const sandbox = createSandbox();
  try {
    const result = sandbox.run();
    assertCompleted(result, "build id success");
    assert.equal(result.status, 0);
    assert.equal(existsSync(join(sandbox.root, "web", ".next", "BUILD_ID")), true);
    assert.match(`${result.stdout}\n${result.stderr}`, /セットアップが完了しました/);
  } finally { sandbox.cleanup(); }
});

test("setup.bat continues when the guard stopped the running WebUI (exit 10)", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ guardExit: 10 });
  try {
    const result = sandbox.run();
    assertCompleted(result, "guard stopped the WebUI");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /WebUIをビルドのために停止しました/);
    assert.equal(existsSync(join(sandbox.root, "web", ".next", "BUILD_ID")), true);
  } finally { sandbox.cleanup(); }
});

test("setup.bat still aborts when the guard cannot free the port", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ guardExit: 1 });
  try {
    const result = sandbox.run();
    assertCompleted(result, "guard refused");
    assert.equal(result.status, 6, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /web build was cancelled/);
    assert.equal(existsSync(join(sandbox.root, "started.txt")), false);
  } finally { sandbox.cleanup(); }
});

test("setup.bat passes --stop to the production WebUI guard", { skip: !isWindows }, () => {
  const source = readFileSync(setupSource, "utf8");
  assert.match(source, /call node scripts\\production-webui-build-guard\.mjs --stop/);
  assert.match(source, /set "WEB_GUARD_EXIT=%ERRORLEVEL%"/);
  assert.match(source, /if "%WEB_GUARD_EXIT%"=="10" goto :web_build_guard_stopped/);
});

test("setup.bat returns documented failures without starting a host", { skip: !isWindows }, () => {
  const cases = [
    ["wingetがありません", { withWinget: false }, 1, "wingetが見つかりません"],
    ["Node.jsの導入に失敗", { nodeMajor: 18, wingetNodeExit: 1 }, 2, "Node.jsの導入に失敗しました"],
    ["Node.jsのPATHが未反映", { withNode: false }, 3, "Node.jsがこのコマンドプロンプトで利用できません"],
    ["OpenCodeのPATHが未反映", { opencodeExit: 1, opencodeWingetMarker: false }, 4, "OpenCodeがこのコマンドプロンプトで利用できません"],
    ["OpenCodeの導入に失敗", { opencodeExit: 1, wingetOpenCodeExit: 1, npmGlobalExit: 1 }, 4, "OpenCodeの導入に失敗しました"],
    ["webのnpm ciに失敗", { npmWebCiExit: 1 }, 5, "webの依存関係の導入に失敗しました"],
    ["webのビルドに失敗", { npmWebBuildExit: 1 }, 6, "webのビルドに失敗しました"],
    ["webのBUILD_IDがない", { createBuildId: false }, 7, "ビルド後にBUILD_IDが見つかりません"],
    ["hostのnpm ciに失敗", { npmHostCiExit: 1 }, 8, "hostの依存関係の導入に失敗しました"],
  ];
  for (const [name, options, expectedExit, expectedMessage] of cases) {
    const sandbox = createSandbox(options);
    try {
      const result = sandbox.run();
      assertCompleted(result, name);
      assert.equal(result.status, expectedExit, `${name}: ${result.stdout}\n${result.stderr}`);
      assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(expectedMessage));
      assert.equal(existsSync(join(sandbox.root, "started.txt")), false, name);
    } finally { sandbox.cleanup(); }
  }
});
