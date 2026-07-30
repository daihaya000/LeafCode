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

/** The launcher exe lives at the repository root, and the internal batch it
 * runs at scripts\start-webui.bat below it (see scripts/launcher/Launcher.cs). */
function fakeRepoLayout(name, batBody) {
  const fakeRepo = mkdtempSync(join(tmpdir(), name));
  mkdirSync(join(fakeRepo, "scripts"), { recursive: true });
  writeFileSync(join(fakeRepo, "scripts", "start-webui.bat"), batBody);
  return fakeRepo;
}

test(
  "Launcher.cs compiles and runs scripts/start-webui.bat below the exe, forwarding its exit code",
  { skip: !isWindows || !csc },
  () => {
    const fakeRepo = fakeRepoLayout(
      "ocwebui-launcher-",
      "@echo off\r\necho FAKE_START_WEBUI_RAN\r\nexit /b 42\r\n",
    );
    const exePath = join(fakeRepo, "OpenCodeWebUI.exe");

    try {
      const compile = compileLauncher(exePath);
      assert.equal(compile.status, 0, `csc failed: ${compile.stderr}\n${compile.stdout}`);
      assert.ok(existsSync(exePath), "expected OpenCodeWebUI.exe to be produced");

      // A trivial stand-in for scripts/start-webui.bat: proves the launcher
      // resolves its own directory as the repo root and forwards cmd's exit
      // code.
      const run = spawnSync(exePath, [], { encoding: "utf8" });
      assert.equal(run.status, 42, `expected the launcher to forward the batch's exit code`);
      assert.match(run.stdout, /FAKE_START_WEBUI_RAN/);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);

test(
  "Launcher.cs runs scripts/start-webui.bat when the repo path contains a cmd metacharacter",
  { skip: !isWindows || !csc },
  () => {
    const fakeRepo = fakeRepoLayout(
      "ocwebui-launcher-&-",
      "@echo off\r\necho METACHAR_PATH_RAN\r\nexit /b 23\r\n",
    );
    const exePath = join(fakeRepo, "OpenCodeWebUI.exe");

    try {
      const compile = compileLauncher(exePath);
      assert.equal(compile.status, 0, `csc failed: ${compile.stderr}\n${compile.stdout}`);

      const run = spawnSync(exePath, [], { encoding: "utf8" });
      assert.equal(run.status, 23, `stderr: ${run.stderr}`);
      assert.match(run.stdout, /METACHAR_PATH_RAN/);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);

test(
  "Launcher.cs runs the batch with the repository root (the exe's directory) as the working directory",
  { skip: !isWindows || !csc },
  () => {
    const fakeRepo = fakeRepoLayout(
      "ocwebui-launcher-cwd-",
      "@echo off\r\necho CWD=%CD%\r\nexit /b 0\r\n",
    );
    const exePath = join(fakeRepo, "OpenCodeWebUI.exe");

    try {
      const compile = compileLauncher(exePath);
      assert.equal(compile.status, 0, `csc failed: ${compile.stderr}\n${compile.stdout}`);

      // Run from an unrelated cwd to prove the launcher sets WorkingDirectory
      // itself (setup/start steps inside the batch rely on repo-relative
      // paths resolving from the root).
      const run = spawnSync(exePath, [], { encoding: "utf8", cwd: tmpdir() });
      assert.equal(run.status, 0, `stderr: ${run.stderr}`);
      assert.match(run.stdout.replace(/\//g, "\\"), new RegExp("CWD=" + fakeRepo.replace(/\\/g, "\\\\"), "i"));
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);

test(
  "Launcher.cs fails clearly when scripts/start-webui.bat is missing below the repo root",
  { skip: !isWindows || !csc },
  () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "ocwebui-launcher-missing-"));
    const exePath = join(fakeRepo, "OpenCodeWebUI.exe");

    try {
      const compile = compileLauncher(exePath);
      assert.equal(compile.status, 0, `csc failed: ${compile.stderr}\n${compile.stdout}`);

      const run = spawnSync(exePath, [], { encoding: "utf8" });
      assert.equal(run.status, 1);
      assert.match(run.stderr, /scripts\\start-webui\.bat not found/);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);
