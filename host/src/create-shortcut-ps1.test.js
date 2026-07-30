import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const scriptPath = join(repoRoot, "scripts", "create-shortcut.ps1");
const iconJsonPath = join(repoRoot, "host", "src", "icon.json");
const isWindows = process.platform === "win32";

/** Build a fake repo layout (scripts/create-shortcut.ps1 + host/src/icon.json,
 * optionally the root OpenCodeWebUI.exe and a stub scripts/build-launcher.bat)
 * so tests control exactly which launcher target is picked, independent of
 * the real repo state. */
function makeFakeRepo({ withExe, buildLauncherBody }) {
  const fakeRepo = mkdtempSync(join(tmpdir(), "ocwebui-shortcut-"));
  mkdirSync(join(fakeRepo, "scripts"), { recursive: true });
  mkdirSync(join(fakeRepo, "host", "src"), { recursive: true });
  copyFileSync(scriptPath, join(fakeRepo, "scripts", "create-shortcut.ps1"));
  copyFileSync(iconJsonPath, join(fakeRepo, "host", "src", "icon.json"));
  if (withExe) {
    // Content does not matter: the script only checks Test-Path existence.
    writeFileSync(join(fakeRepo, "OpenCodeWebUI.exe"), "stub");
  }
  if (buildLauncherBody !== undefined) {
    writeFileSync(join(fakeRepo, "scripts", "build-launcher.bat"), buildLauncherBody);
  }
  return fakeRepo;
}

function runScript(fakeScriptPath, desktopDir, iconDir) {
  return spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      fakeScriptPath,
      "-DesktopDir",
      desktopDir,
      "-IconOutputDir",
      iconDir,
    ],
    { encoding: "utf8" },
  );
}

test(
  "create-shortcut.ps1 targets the root OpenCodeWebUI.exe when present",
  { skip: !isWindows },
  () => {
    const fakeRepo = makeFakeRepo({ withExe: true });
    const out = join(fakeRepo, "out");
    mkdirSync(out, { recursive: true });
    try {
      const result = runScript(join(fakeRepo, "scripts", "create-shortcut.ps1"), out, out);
      assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
      assert.match(result.stdout, /SHORTCUT_PATH=/);
      assert.match(result.stdout, /TARGET_PATH=.*OpenCodeWebUI\.exe/);
      assert.match(result.stdout, /ICON_PATH=/);
      assert.ok(existsSync(join(out, "OpenCode WebUI.lnk")), "expected the .lnk shortcut to be written");

      const iconPath = join(out, "app.ico");
      assert.ok(existsSync(iconPath), "expected app.ico to be written");

      // ICO magic: reserved=0, type=1 (icon), at least one image entry follows.
      const icoBytes = readFileSync(iconPath);
      assert.equal(icoBytes[0], 0, "ICO reserved byte");
      assert.equal(icoBytes[1], 0, "ICO reserved byte");
      assert.equal(icoBytes[2], 1, "ICO type byte");
      assert.equal(icoBytes[3], 0, "ICO type byte");
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);

test(
  "create-shortcut.ps1 rebuilds a missing root launcher via scripts/build-launcher.bat, then targets it",
  { skip: !isWindows },
  () => {
    // A stub build script standing in for the real csc compile: it creates
    // the exe at the repo root, exactly where build-launcher.bat outputs it.
    const fakeRepo = makeFakeRepo({
      withExe: false,
      buildLauncherBody: "@echo off\r\ntype nul > \"%~dp0..\\OpenCodeWebUI.exe\"\r\nexit /b 0\r\n",
    });
    const out = join(fakeRepo, "out");
    mkdirSync(out, { recursive: true });
    try {
      const result = runScript(join(fakeRepo, "scripts", "create-shortcut.ps1"), out, out);
      assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
      assert.match(result.stdout, /TARGET_PATH=.*OpenCodeWebUI\.exe/);
      assert.ok(existsSync(join(out, "OpenCode WebUI.lnk")), "expected the .lnk shortcut to be written");
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);

test(
  "create-shortcut.ps1 fails clearly when the launcher is missing and cannot be rebuilt",
  { skip: !isWindows },
  () => {
    const fakeRepo = makeFakeRepo({
      withExe: false,
      buildLauncherBody: "@echo off\r\nexit /b 1\r\n",
    });
    const out = join(fakeRepo, "out");
    mkdirSync(out, { recursive: true });
    try {
      const result = runScript(join(fakeRepo, "scripts", "create-shortcut.ps1"), out, out);
      assert.notEqual(result.status, 0, "expected a non-zero exit when the launcher cannot be built");
      assert.match(result.stderr, /Launcher not found/i);
      assert.ok(!existsSync(join(out, "OpenCode WebUI.lnk")), "must not create a shortcut on failure");
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);

test(
  "create-shortcut.ps1 fails clearly when icon.json is missing",
  { skip: !isWindows },
  () => {
    // Same fake-repo layout, but without host/src/icon.json, since
    // $PSScriptRoot drives the repo-root lookup. Exercises the "run
    // gen-icons.mjs first" error path without touching the real repo.
    const fakeRepo = mkdtempSync(join(tmpdir(), "ocwebui-shortcut-missing-"));
    const fakeScripts = join(fakeRepo, "scripts");
    const outDir = join(fakeRepo, "out");
    mkdirSync(fakeScripts, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    const fakeScriptPath = join(fakeScripts, "create-shortcut.ps1");
    copyFileSync(scriptPath, fakeScriptPath);
    try {
      const result = runScript(fakeScriptPath, outDir, outDir);
      assert.notEqual(result.status, 0, "expected a non-zero exit when icon.json is absent");
      assert.match(result.stderr, /icon\.json/i);
      assert.ok(!existsSync(join(outDir, "OpenCode WebUI.lnk")), "must not create a shortcut on failure");
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);
