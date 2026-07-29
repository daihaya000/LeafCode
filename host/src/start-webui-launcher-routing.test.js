import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Exercises the "route through the compiled native launcher" block that
// start-webui.bat runs before anything else (see scripts/launcher/Launcher.cs
// for the other half: it sets OPENCODE_WEBUI_LAUNCHER=1 on the bat instance
// it starts, which is what breaks the loop tested here).

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const startWebuiSource = join(repoRoot, "start-webui.bat");
const isWindows = process.platform === "win32";

function findCsc() {
  const candidates = [
    join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

const csc = isWindows ? findCsc() : null;

/** Compile a minimal marker program (prints MARKER_RAN, exits with `code`)
 * to stand in for scripts/launcher/OpenCodeWebUI.exe: proves start-webui.bat
 * really executed the .exe, without depending on the real Launcher.cs. */
function compileMarkerExe(outExe, code) {
  const dir = dirname(outExe);
  const srcPath = join(dir, `marker-${code}.cs`);
  writeFileSync(
    srcPath,
    `using System;\ninternal static class Marker { private static int Main() { Console.WriteLine("MARKER_RAN"); return ${code}; } }\n`,
  );
  const compile = spawnSync(csc, ["/nologo", "/target:exe", `/out:${outExe}`, srcPath], {
    encoding: "utf8",
  });
  rmSync(srcPath, { force: true });
  return compile;
}

/** A repo layout that lets start-webui.bat's routing block run without
 * falling into the real (slow / network-dependent) install/build steps
 * further down the file: fake web/host node_modules + a stub .next build so
 * every `if not exist ...` guard below the routing block is satisfied. */
function makeFakeRepo() {
  const fakeRepo = mkdtempSync(join(tmpdir(), "ocwebui-start-routing-"));
  copyFileSync(startWebuiSource, join(fakeRepo, "start-webui.bat"));
  mkdirSync(join(fakeRepo, "web", "node_modules"), { recursive: true });
  mkdirSync(join(fakeRepo, "web", ".next"), { recursive: true });
  writeFileSync(join(fakeRepo, "web", ".next", "BUILD_ID"), "fake\r\n");
  mkdirSync(join(fakeRepo, "host", "node_modules"), { recursive: true });
  // host/src/index.js intentionally does not exist: once routing is skipped
  // (OPENCODE_WEBUI_LAUNCHER=1 case) `node src\index.js` fails fast with a
  // "Cannot find module" error instead of doing real work, which is enough
  // to prove the script reached that point instead of hanging or installing.
  return fakeRepo;
}

function runStartWebui(fakeRepo, env) {
  return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "start-webui.bat"], {
    cwd: fakeRepo,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15000,
  });
}

test(
  "start-webui.bat routes into scripts/launcher/OpenCodeWebUI.exe when it already exists, without reaching the normal startup steps",
  { skip: !isWindows || !csc },
  () => {
    const fakeRepo = makeFakeRepo();
    const launcherDir = join(fakeRepo, "scripts", "launcher");
    mkdirSync(launcherDir, { recursive: true });
    const exePath = join(launcherDir, "OpenCodeWebUI.exe");
    try {
      const compile = compileMarkerExe(exePath, 7);
      assert.equal(compile.status, 0, `csc failed: ${compile.stderr}\n${compile.stdout}`);

      const result = runStartWebui(fakeRepo, { OPENCODE_WEBUI_LAUNCHER: "" });
      assert.equal(result.status, 7, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
      assert.match(result.stdout, /MARKER_RAN/);
      assert.doesNotMatch(result.stdout, /\[OpenCode WebUI\] Starting/);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);

test(
  "start-webui.bat rebuilds an existing launcher when its build inputs are newer",
  { skip: !isWindows || !csc },
  () => {
    const fakeRepo = makeFakeRepo();
    const scriptsDir = join(fakeRepo, "scripts");
    const launcherDir = join(scriptsDir, "launcher");
    mkdirSync(launcherDir, { recursive: true });
    const exePath = join(launcherDir, "OpenCodeWebUI.exe");
    const prebuiltReplacement = join(fakeRepo, "replacement.exe");
    try {
      const oldCompile = compileMarkerExe(exePath, 7);
      assert.equal(oldCompile.status, 0, `csc failed: ${oldCompile.stderr}\n${oldCompile.stdout}`);
      const newCompile = compileMarkerExe(prebuiltReplacement, 9);
      assert.equal(newCompile.status, 0, `csc failed: ${newCompile.stderr}\n${newCompile.stdout}`);

      writeFileSync(
        join(scriptsDir, "build-launcher.bat"),
        [
          "@echo off",
          "echo [OpenCode WebUI] FAKE_STALE_REBUILD_RAN",
          `copy /y "${prebuiltReplacement}" "%~dp0launcher\\OpenCodeWebUI.exe" >nul`,
          "exit /b 0",
        ].join("\r\n") + "\r\n",
      );

      const result = runStartWebui(fakeRepo, { OPENCODE_WEBUI_LAUNCHER: "" });
      assert.equal(result.status, 9, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
      assert.match(result.stdout, /FAKE_STALE_REBUILD_RAN/);
      assert.match(result.stdout, /MARKER_RAN/);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);

test(
  "start-webui.bat skips launcher routing when OPENCODE_WEBUI_LAUNCHER=1 is already set, and proceeds to the normal startup steps",
  { skip: !isWindows || !csc },
  () => {
    const fakeRepo = makeFakeRepo();
    const launcherDir = join(fakeRepo, "scripts", "launcher");
    mkdirSync(launcherDir, { recursive: true });
    const exePath = join(launcherDir, "OpenCodeWebUI.exe");
    try {
      // A stub .exe is present but must NOT be invoked in this case.
      const compile = compileMarkerExe(exePath, 7);
      assert.equal(compile.status, 0, `csc failed: ${compile.stderr}\n${compile.stdout}`);

      const result = runStartWebui(fakeRepo, { OPENCODE_WEBUI_LAUNCHER: "1" });
      assert.match(result.stdout, /\[OpenCode WebUI\] Starting/);
      assert.doesNotMatch(result.stdout, /MARKER_RAN/);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);

test(
  "start-webui.bat builds the launcher on first run (via scripts/build-launcher.bat /quiet) when it is missing, then routes into it",
  { skip: !isWindows || !csc },
  () => {
    const fakeRepo = makeFakeRepo();
    const scriptsDir = join(fakeRepo, "scripts");
    const launcherDir = join(scriptsDir, "launcher");
    mkdirSync(launcherDir, { recursive: true });
    const exePath = join(launcherDir, "OpenCodeWebUI.exe");
    const stubExeSource = join(fakeRepo, "stub-source-dir");
    mkdirSync(stubExeSource, { recursive: true });
    const prebuiltStub = join(stubExeSource, "OpenCodeWebUI.exe");

    try {
      // Pre-compile the marker exe elsewhere, then have a fake
      // build-launcher.bat "install" it, standing in for a real compile.
      // This isolates the test from csc/icon-extraction details already
      // covered by scripts/build-launcher.bat's own responsibility and by
      // launcher-exe.test.js, and keeps the assertion focused on
      // start-webui.bat's own build-then-route wiring.
      const compile = compileMarkerExe(prebuiltStub, 9);
      assert.equal(compile.status, 0, `csc failed: ${compile.stderr}\n${compile.stdout}`);

      writeFileSync(
        join(scriptsDir, "build-launcher.bat"),
        [
          "@echo off",
          'echo [OpenCode WebUI] FAKE_BUILD_LAUNCHER_RAN args=%1',
          `copy /y "${prebuiltStub}" "%~dp0launcher\\OpenCodeWebUI.exe" >nul`,
          "exit /b 0",
        ].join("\r\n") + "\r\n",
      );

      assert.ok(!existsSync(exePath), "exe must not exist before running start-webui.bat");
      const result = runStartWebui(fakeRepo, { OPENCODE_WEBUI_LAUNCHER: "" });
      assert.equal(result.status, 9, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
      assert.match(result.stdout, /FAKE_BUILD_LAUNCHER_RAN args=\/quiet/);
      assert.match(result.stdout, /MARKER_RAN/);
      assert.doesNotMatch(result.stdout, /\[OpenCode WebUI\] Starting/);
      assert.ok(existsSync(exePath), "expected build-launcher.bat to have produced the exe");
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);

test(
  "start-webui.bat falls back to the normal startup steps when the launcher cannot be built",
  { skip: !isWindows },
  () => {
    const fakeRepo = makeFakeRepo();
    const scriptsDir = join(fakeRepo, "scripts");
    mkdirSync(scriptsDir, { recursive: true });
    // A build-launcher.bat stand-in that fails to produce an exe (e.g. no
    // csc.exe available), mirroring the real script's exit /b 1 paths.
    writeFileSync(
      join(scriptsDir, "build-launcher.bat"),
      "@echo off\r\necho [OpenCode WebUI] FAKE_BUILD_LAUNCHER_FAILED\r\nexit /b 1\r\n",
    );

    try {
      const result = runStartWebui(fakeRepo, { OPENCODE_WEBUI_LAUNCHER: "" });
      assert.match(result.stdout, /FAKE_BUILD_LAUNCHER_FAILED/);
      assert.match(result.stdout, /\[OpenCode WebUI\] Starting/);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);
