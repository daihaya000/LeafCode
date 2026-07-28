import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const launcherSource = join(repoRoot, "scripts", "launcher", "Launcher.cs");
const isWindows = process.platform === "win32";

/** Same well-known .NET Framework compiler paths as scripts/build-launcher.bat. */
function findCsc() {
  const candidates = [
    join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

const csc = isWindows ? findCsc() : null;

/** Compile Launcher.cs into `outExe` (no icon: keeps the test fast and
 * independent of scripts/build-launcher.bat's icon-extraction step). */
function compileLauncher(outExe) {
  return spawnSync(csc, ["/nologo", "/target:exe", `/out:${outExe}`, launcherSource], {
    encoding: "utf8",
  });
}

test(
  "Launcher.cs compiles and runs the sibling start-webui.bat, forwarding its exit code",
  { skip: !isWindows || !csc },
  () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "ocwebui-launcher-"));
    const launcherDir = join(fakeRepo, "scripts", "launcher");
    mkdirSync(launcherDir, { recursive: true });
    const exePath = join(launcherDir, "OpenCodeWebUI.exe");

    // A trivial stand-in for start-webui.bat: proves the launcher resolves
    // "<exeDir>/../.." as the repo root and forwards cmd's exit code.
    writeFileSync(
      join(fakeRepo, "start-webui.bat"),
      "@echo off\r\necho FAKE_START_WEBUI_RAN\r\nexit /b 42\r\n",
    );

    try {
      const compile = compileLauncher(exePath);
      assert.equal(compile.status, 0, `csc failed: ${compile.stderr}\n${compile.stdout}`);
      assert.ok(existsSync(exePath), "expected OpenCodeWebUI.exe to be produced");

      const run = spawnSync(exePath, [], { encoding: "utf8" });
      assert.equal(run.status, 42, `expected the launcher to forward start-webui.bat's exit code`);
      assert.match(run.stdout, /FAKE_START_WEBUI_RAN/);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);

test(
  "Launcher.cs fails clearly when start-webui.bat is missing next to the repo root",
  { skip: !isWindows || !csc },
  () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "ocwebui-launcher-missing-"));
    const launcherDir = join(fakeRepo, "scripts", "launcher");
    mkdirSync(launcherDir, { recursive: true });
    const exePath = join(launcherDir, "OpenCodeWebUI.exe");

    try {
      const compile = compileLauncher(exePath);
      assert.equal(compile.status, 0, `csc failed: ${compile.stderr}\n${compile.stdout}`);

      const run = spawnSync(exePath, [], { encoding: "utf8" });
      assert.equal(run.status, 1);
      assert.match(run.stderr, /start-webui\.bat not found/);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);
