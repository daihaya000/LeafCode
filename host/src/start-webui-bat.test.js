import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

// start-webui.bat used to be split into a one-time setup.bat (winget / Node.js /
// OpenCode / dependency installs, ending by starting a *separate* start-webui.bat
// in a detached console) and start-webui.bat itself (assumed already installed).
// setup.bat has been deleted and its logic absorbed into start-webui.bat: every
// check below is a no-op once its condition is already satisfied (idempotent),
// and the script continues in the same console straight into the host tail
// (`cd host && node src\index.js`, foreground) instead of handing off to a
// second process. See docs/specs/setup-start-webui-merge.md.

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const startWebuiSource = join(repoRoot, "start-webui.bat");
const messagesSource = join(repoRoot, "scripts", "setup-messages");
const isWindows = process.platform === "win32";

function writeBat(path, contents) {
  const normalized = contents.replace(/\r?\n/g, "\r\n");
  writeFileSync(path, `@echo off\r\n${normalized}\r\n`, "utf8");
}

function createSandbox(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "OpenCodeWebUI-start-"));
  const bin = join(root, "mock-bin");
  const log = join(root, "commands.log");
  mkdirSync(bin);
  // web/host start empty (no node_modules, no .next) unless the test pre-seeds
  // them via options below, which exercises the idempotent fast path.
  mkdirSync(join(root, "web"), { recursive: true });
  mkdirSync(join(root, "host"), { recursive: true });
  writeFileSync(join(root, "start-webui.bat"), readFileSync(startWebuiSource));
  if (options.withMessages !== false) {
    mkdirSync(join(root, "scripts"), { recursive: true });
    cpSync(messagesSource, join(root, "scripts", "setup-messages"), { recursive: true });
  }

  if (options.webNodeModules) mkdirSync(join(root, "web", "node_modules"), { recursive: true });
  if (options.webBuildId) {
    mkdirSync(join(root, "web", ".next"), { recursive: true });
    writeFileSync(join(root, "web", ".next", "BUILD_ID"), "preexisting-build\r\n");
  }
  if (options.hostNodeModules) {
    mkdirSync(join(root, "host", "node_modules", "ws"), { recursive: true });
    writeFileSync(join(root, "host", "node_modules", "ws", "package.json"), "{}\r\n", "ascii");
  }

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
    const nodeScript = [
      'if "%~1"=="scripts\\production-webui-build-guard.mjs" exit /b %SETUP_TEST_GUARD_EXIT%',
      'if "%~1"=="-p" goto :version_query',
      'if "%~1"=="src\\index.js" goto :host_tail',
      "exit /b 0",
      ":version_query",
      'if exist "%SETUP_TEST_ROOT%\\node-installed" echo %SETUP_TEST_NODE_MAJOR_AFTER_INSTALL%',
      'if exist "%SETUP_TEST_ROOT%\\node-installed" exit /b 0',
      "echo %SETUP_TEST_NODE_MAJOR%",
      "exit /b 0",
      ":host_tail",
      'type nul > "%SETUP_TEST_ROOT%\\hoststarted.txt"',
      "exit /b %SETUP_TEST_HOST_EXIT%",
    ].join("\n");
    writeBat(join(bin, "node.cmd"), nodeScript);
    if (options.standardNodePath) {
      const standardNodePath = join(root, "nodejs");
      mkdirSync(standardNodePath);
      writeBat(join(standardNodePath, "node.cmd"), nodeScript);
      writeFileSync(join(standardNodePath, "node.exe"), "", "ascii");
    }
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
    ProgramFiles: root,
    PATHEXT: options.standardNodePath ? ".CMD;.EXE;.BAT;.COM" : ".COM;.EXE;.BAT;.CMD",
    // Skip the native-launcher routing block: it is covered separately by
    // start-webui-launcher-routing.test.js and is orthogonal to the setup
    // logic under test here.
    OPENCODE_WEBUI_LAUNCHER: "1",
    OPENCODE_WEBUI_NONINTERACTIVE: "1",
    SETUP_TEST_ROOT: root,
    SETUP_TEST_LOG: log,
    SETUP_TEST_NODE_MAJOR: String(options.nodeMajor ?? 22),
    SETUP_TEST_NODE_MAJOR_AFTER_INSTALL: String(options.nodeMajorAfterInstall ?? 22),
    SETUP_TEST_NODE_STANDARD_PATH: options.standardNodePath ? join(root, "nodejs") : "",
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
    SETUP_TEST_HOST_EXIT: String(options.hostExit ?? 0),
  };
  return {
    root,
    log,
    run({ captureOutput = true, timeout = 30_000, codePage } = {}) {
      const outFile = join(root, "stdout.txt");
      const errFile = join(root, "stderr.txt");
      const codePageFile = join(root, "code-page-after.txt");
      const wrapper = join(root, "_run.bat");
      const lines = ["@echo off", 'set "ProgramFiles=%SETUP_TEST_ROOT%"'];
      if (codePage !== undefined) lines.push(`chcp ${codePage} >nul`);
      lines.push(captureOutput ? `call start-webui.bat >"${outFile}" 2>"${errFile}"` : "call start-webui.bat");
      // Keep start-webui.bat's exit code: the trailing chcp probe must not overwrite it.
      lines.push('set "SETUP_TEST_STATUS=%ERRORLEVEL%"');
      lines.push(`chcp >"${codePageFile}" 2>&1`);
      lines.push("exit /b %SETUP_TEST_STATUS%");
      writeFileSync(wrapper, `${lines.join("\r\n")}\r\n`, "utf8");
      const result = spawnSync(process.env.ComSpec ?? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), ["/d", "/c", "call _run.bat"], {
        cwd: root, encoding: "utf8", env, timeout, windowsHide: true,
        stdio: "ignore",
      });
      if (captureOutput) {
        result.stdout = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
        result.stderr = existsSync(errFile) ? readFileSync(errFile, "utf8") : "";
        // Raw bytes let assertions detect mojibake that utf8 decoding would hide.
        result.stdoutBytes = existsSync(outFile) ? readFileSync(outFile, "latin1") : "";
        result.stderrBytes = existsSync(errFile) ? readFileSync(errFile, "latin1") : "";
      }
      const codePageAfter = existsSync(codePageFile)
        ? /(\d{3,5})/.exec(readFileSync(codePageFile, "latin1"))?.[1]
        : undefined;
      return { ...result, codePageAfter };
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

test("start-webui.bat installs winget/Node.js/OpenCode/deps on a fresh machine, then reaches the host tail", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ nodeMajor: 18, nodeMajorAfterInstall: 22, opencodeExit: 1 });
  try {
    const result = sandbox.run();
    assertCompleted(result, "fresh machine");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(join(sandbox.root, "opencode-winget-installed")), true);
    assert.equal(existsSync(join(sandbox.root, "opencode-npm-installed")), false);
    assert.equal(existsSync(join(sandbox.root, "web", ".next", "BUILD_ID")), true);
    assert.equal(existsSync(join(sandbox.root, "hoststarted.txt")), true, "expected the host tail to run");
    const log = readFileSync(sandbox.log, "utf8");
    assert.match(log, /install --id OpenJS\.NodeJS\.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity/);
    assert.match(log, /install --id SST\.opencode --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity/);
    assert.match(log, /npm .*\\web ci/);
    assert.match(log, /npm .*\\host ci/);
    assert.doesNotMatch(log, /npm .* install -g opencode-ai/);
  } finally { sandbox.cleanup(); }
});

test("start-webui.bat uses standard MSI Node.js when winget does not refresh PATH", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ nodeMajor: 18, nodeMajorAfterInstall: 22, standardNodePath: true, opencodeExit: 1 });
  try {
    assert.match(readFileSync(startWebuiSource, "utf8"), /if exist "%ProgramFiles%\\nodejs\\node\.exe" set "PATH=%ProgramFiles%\\nodejs;%PATH%"/);
    const result = sandbox.run();
    assertCompleted(result, "standard MSI Node.js fallback");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(join(sandbox.root, "hoststarted.txt")), true, "expected the host tail to run");
  } finally { sandbox.cleanup(); }
});

test("start-webui.bat falls back to npm only after the OpenCode winget install fails", { skip: !isWindows }, () => {
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

test("start-webui.bat skips npm ci / build / guard entirely when already installed (idempotent fast path)", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ webNodeModules: true, webBuildId: true, hostNodeModules: true });
  try {
    const result = sandbox.run();
    assertCompleted(result, "idempotent fast path");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(join(sandbox.root, "hoststarted.txt")), true);
    assert.match(result.stdout, /Existing build found; host will rebuild if sources are newer/);
    const log = existsSync(sandbox.log) ? readFileSync(sandbox.log, "utf8") : "";
    assert.doesNotMatch(log, /\bci\b/, "npm ci must not run when node_modules already exists");
    assert.doesNotMatch(log, /run build/, "npm run build must not run when BUILD_ID already exists");
  } finally { sandbox.cleanup(); }
});

test("start-webui.bat passes through the host's real exit code from the tail", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ webNodeModules: true, webBuildId: true, hostNodeModules: true, hostExit: 42 });
  try {
    const result = sandbox.run();
    assertCompleted(result, "host exit code passthrough");
    assert.equal(result.status, 42, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Host exited with code 42/);
    assert.equal(existsSync(join(sandbox.root, "hoststarted.txt")), true);
  } finally { sandbox.cleanup(); }
});

test("start-webui.bat continues when the guard stopped the running WebUI (exit 10)", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ webNodeModules: true, hostNodeModules: true, guardExit: 10 });
  try {
    const result = sandbox.run();
    assertCompleted(result, "guard stopped the WebUI");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /WebUIをビルドのために停止しました/);
    assert.equal(existsSync(join(sandbox.root, "web", ".next", "BUILD_ID")), true);
    assert.equal(existsSync(join(sandbox.root, "hoststarted.txt")), true);
  } finally { sandbox.cleanup(); }
});

test("start-webui.bat still aborts when the guard cannot free the port", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ webNodeModules: true, hostNodeModules: true, guardExit: 1 });
  try {
    const result = sandbox.run();
    assertCompleted(result, "guard refused");
    assert.equal(result.status, 6, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /web build was cancelled/);
    assert.equal(existsSync(join(sandbox.root, "hoststarted.txt")), false);
  } finally { sandbox.cleanup(); }
});

test("start-webui.bat runs cleanly on legacy and UTF-8 code pages", { skip: !isWindows }, () => {
  for (const codePage of [932, 437, 65001]) {
    const sandbox = createSandbox({ npmWebCiExit: 1 });
    try {
      const result = sandbox.run({ codePage });
      assertCompleted(result, `code page ${codePage}`);
      assert.equal(result.status, 5, `cp${codePage}: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /\[OpenCode WebUI\] ERROR 5/, `cp${codePage} lost the ASCII summary`);
      assert.match(result.stdout, /webの依存関係の導入に失敗しました/, `cp${codePage} lost the Japanese message`);
      // A non-ASCII batch file makes cmd.exe lose its read position and execute
      // fragments of later lines, which shows up as unknown-command errors.
      assert.doesNotMatch(result.stdoutBytes, /is not recognized as an internal or external command/, `cp${codePage} misparsed start-webui.bat`);
      assert.equal(result.stderrBytes.trim(), "", `cp${codePage} wrote to stderr: ${result.stderrBytes}`);
    } finally { sandbox.cleanup(); }
  }
});

test("start-webui.bat restores the code page it inherited", { skip: !isWindows }, () => {
  for (const codePage of [932, 437]) {
    const sandbox = createSandbox({ webNodeModules: true, webBuildId: true, hostNodeModules: true });
    try {
      const result = sandbox.run({ codePage });
      assertCompleted(result, `code page ${codePage}`);
      assert.equal(result.status, 0, `cp${codePage}: ${result.stdout}\n${result.stderr}`);
      assert.equal(result.codePageAfter, String(codePage), `cp${codePage} was not restored`);
    } finally { sandbox.cleanup(); }
  }
});

test("start-webui.bat reports an ASCII-only failure when the message files are missing", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ withMessages: false, npmWebCiExit: 1 });
  try {
    const result = sandbox.run();
    assertCompleted(result, "missing message files");
    assert.equal(result.status, 5, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[OpenCode WebUI\] ERROR 5/);
    assert.doesNotMatch(result.stdout, /依存関係/);
    assert.equal(result.stderrBytes.trim(), "", `stderr: ${result.stderrBytes}`);
  } finally { sandbox.cleanup(); }
});

test("start-webui.bat reports failures as an ASCII code line plus Japanese detail", { skip: !isWindows }, () => {
  const sandbox = createSandbox({ npmWebCiExit: 1 });
  try {
    const result = sandbox.run({ codePage: 932 });
    assertCompleted(result, "failure formatting");
    assert.equal(result.status, 5, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[OpenCode WebUI\] ERROR 5: web dependencies could not be installed\./);
    assert.match(result.stdout, /webの依存関係の導入に失敗しました/);
    assert.match(result.stdout, /\[OpenCode WebUI\] FAILED with exit code 5\./);
    assert.match(result.stdout, /セットアップに失敗しました/);
  } finally { sandbox.cleanup(); }
});

test("start-webui.bat passes --stop to the production WebUI guard", { skip: !isWindows }, () => {
  const source = readFileSync(startWebuiSource, "utf8");
  assert.match(source, /call node scripts\\production-webui-build-guard\.mjs --stop/);
  assert.match(source, /set "WEB_GUARD_EXIT=%ERRORLEVEL%"/);
  assert.match(source, /if "%WEB_GUARD_EXIT%"=="10" goto :web_build_guard_stopped/);
});

test("start-webui.bat returns documented failures without reaching the host tail", { skip: !isWindows }, () => {
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
      assert.equal(existsSync(join(sandbox.root, "hoststarted.txt")), false, name);
    } finally { sandbox.cleanup(); }
  }
});
