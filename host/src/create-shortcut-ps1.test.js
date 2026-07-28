import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const scriptPath = join(repoRoot, "scripts", "create-shortcut.ps1");
const isWindows = process.platform === "win32";

function runScript(desktopDir, iconDir) {
  return spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-DesktopDir",
      desktopDir,
      "-IconOutputDir",
      iconDir,
    ],
    { encoding: "utf8" },
  );
}

test(
  "create-shortcut.ps1 writes a valid .ico and a .lnk pointing at start-webui.bat",
  { skip: !isWindows },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "ocwebui-shortcut-"));
    try {
      const result = runScript(dir, dir);
      assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
      assert.match(result.stdout, /SHORTCUT_PATH=/);
      assert.match(result.stdout, /ICON_PATH=/);

      const iconPath = join(dir, "app.ico");
      const shortcutPath = join(dir, "OpenCode WebUI.lnk");
      assert.ok(existsSync(iconPath), "expected app.ico to be written");
      assert.ok(existsSync(shortcutPath), "expected the .lnk shortcut to be written");

      // ICO magic: reserved=0, type=1 (icon), at least one image entry follows.
      const icoBytes = readFileSync(iconPath);
      assert.equal(icoBytes[0], 0, "ICO reserved byte");
      assert.equal(icoBytes[1], 0, "ICO reserved byte");
      assert.equal(icoBytes[2], 1, "ICO type byte");
      assert.equal(icoBytes[3], 0, "ICO type byte");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "create-shortcut.ps1 fails clearly when icon.json is missing",
  { skip: !isWindows },
  () => {
    // Copy the script into a fake repo layout (scripts/ sibling of host/src/)
    // without host/src/icon.json, since $PSScriptRoot drives the repo-root
    // lookup. This exercises the "run gen-icons.mjs first" error path
    // without touching the real repo.
    const fakeRepo = mkdtempSync(join(tmpdir(), "ocwebui-shortcut-missing-"));
    const fakeScripts = join(fakeRepo, "scripts");
    const outDir = join(fakeRepo, "out");
    mkdirSync(fakeScripts, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    const fakeScriptPath = join(fakeScripts, "create-shortcut.ps1");
    copyFileSync(scriptPath, fakeScriptPath);
    try {
      const result = spawnSync(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fakeScriptPath, "-DesktopDir", outDir, "-IconOutputDir", outDir],
        { encoding: "utf8" },
      );
      assert.notEqual(result.status, 0, "expected a non-zero exit when icon.json is absent");
      assert.match(result.stderr, /icon\.json/i);
      assert.ok(!existsSync(join(outDir, "OpenCode WebUI.lnk")), "must not create a shortcut on failure");
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  },
);
