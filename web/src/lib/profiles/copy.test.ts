import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyTree,
  countEntries,
  DUPLICATE_EXCLUDES,
  MIGRATE_EXCLUDES,
  verifyCopy,
} from "./copy";

let sandbox: string;

/** Build a tree that mirrors the real config: files, dirs, .git, node_modules symlinks. */
function makeSourceTree(root: string): void {
  fs.mkdirSync(path.join(root, "agents"), { recursive: true });
  fs.mkdirSync(path.join(root, ".git", "objects"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "pkg-a"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });

  fs.writeFileSync(path.join(root, "opencode.jsonc"), '{"model":"test"}');
  fs.writeFileSync(path.join(root, "agents", "build.md"), "# build");
  fs.writeFileSync(path.join(root, ".git", "config"), "[core]");
  fs.writeFileSync(path.join(root, "packages", "pkg-a", "index.js"), "module.exports={}");

  // Mirrors the real config: node_modules/<pkg> -> packages/<pkg> via absolute path
  fs.symlinkSync(
    path.join(root, "packages", "pkg-a"),
    path.join(root, "node_modules", "pkg-a"),
    "junction",
  );
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "profiles-copy-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("countEntries", () => {
  it("counts files and symlinks, not directories", async () => {
    const src = path.join(sandbox, "src");
    makeSourceTree(src);

    // opencode.jsonc + agents/build.md + .git/config + packages/pkg-a/index.js + node_modules/pkg-a (symlink)
    // = 5 entries (directories not counted)
    expect(await countEntries(src)).toBe(5);
  });

  it("respects exclude set", async () => {
    const src = path.join(sandbox, "src");
    makeSourceTree(src);

    // Excluding .git removes .git/config → 4
    expect(await countEntries(src, DUPLICATE_EXCLUDES)).toBe(4);
  });
});

describe("copyTree", () => {
  it("copies all files and directories", async () => {
    const src = path.join(sandbox, "src");
    const dest = path.join(sandbox, "dest");
    makeSourceTree(src);

    const result = await copyTree(src, dest);

    expect(result.copied).toBe(5);
    expect(result.dereferenced).toBe(false);
    expect(fs.readFileSync(path.join(dest, "opencode.jsonc"), "utf8")).toBe('{"model":"test"}');
    expect(fs.readFileSync(path.join(dest, "agents", "build.md"), "utf8")).toBe("# build");
    expect(fs.readFileSync(path.join(dest, ".git", "config"), "utf8")).toBe("[core]");
  });

  it("excludes .git when duplicating", async () => {
    const src = path.join(sandbox, "src");
    const dest = path.join(sandbox, "dest");
    makeSourceTree(src);

    await copyTree(src, dest, { exclude: DUPLICATE_EXCLUDES });

    expect(fs.existsSync(path.join(dest, ".git"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "opencode.jsonc"))).toBe(true);
  });

  it("keeps .git when migrating", async () => {
    const src = path.join(sandbox, "src");
    const dest = path.join(sandbox, "dest");
    makeSourceTree(src);

    await copyTree(src, dest, { exclude: MIGRATE_EXCLUDES });

    expect(fs.existsSync(path.join(dest, ".git", "config"))).toBe(true);
  });

  it("preserves node_modules symlinks as symlinks", async () => {
    const src = path.join(sandbox, "src");
    const dest = path.join(sandbox, "dest");
    makeSourceTree(src);

    await copyTree(src, dest);

    const linkStat = await fsp.lstat(path.join(dest, "node_modules", "pkg-a"));
    expect(linkStat.isSymbolicLink()).toBe(true);
    // The link target is preserved verbatim (absolute path to src's packages)
    const target = await fsp.readlink(path.join(dest, "node_modules", "pkg-a"));
    expect(target).toBe(path.join(src, "packages", "pkg-a"));
  });

  it("reports monotonically increasing progress", async () => {
    const src = path.join(sandbox, "src");
    const dest = path.join(sandbox, "dest");
    makeSourceTree(src);

    const progressValues: number[] = [];
    await copyTree(src, dest, {
      onProgress: (n) => progressValues.push(n),
    });

    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThan(progressValues[i - 1]);
    }
    expect(progressValues[progressValues.length - 1]).toBe(5);
  });

  it("falls back to dereference on EPERM", async () => {
    const src = path.join(sandbox, "src");
    const dest = path.join(sandbox, "dest");
    makeSourceTree(src);

    // Make symlink creation fail with EPERM
    const symlinkSpy = vi.spyOn(fsp, "symlink").mockRejectedValue(
      Object.assign(new Error("EPERM"), { code: "EPERM" }),
    );

    const result = await copyTree(src, dest);
    symlinkSpy.mockRestore();

    expect(result.dereferenced).toBe(true);
    // The symlink was replaced by its contents
    const linkStat = await fsp.lstat(path.join(dest, "node_modules", "pkg-a"));
    expect(linkStat.isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(dest, "node_modules", "pkg-a", "index.js"))).toBe(true);
  });

  it("copies an empty directory without error", async () => {
    const src = path.join(sandbox, "src");
    const dest = path.join(sandbox, "dest");
    fs.mkdirSync(src);

    const result = await copyTree(src, dest);
    expect(result.copied).toBe(0);
    expect(fs.existsSync(dest)).toBe(true);
  });
});

describe("verifyCopy", () => {
  it("passes when counts match and a marker exists", async () => {
    const dest = path.join(sandbox, "dest");
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, "opencode.jsonc"), "{}");

    await expect(verifyCopy(dest, 1, 1)).resolves.toBeUndefined();
  });

  it("fails when copied < total", async () => {
    const dest = path.join(sandbox, "dest");
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, "opencode.jsonc"), "{}");

    await expect(verifyCopy(dest, 3, 5)).rejects.toThrow(/不完全/);
  });

  it("fails when no config marker exists", async () => {
    const dest = path.join(sandbox, "dest");
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, "random.txt"), "hi");

    await expect(verifyCopy(dest, 1, 1)).rejects.toThrow(/認識できません/);
  });
});
