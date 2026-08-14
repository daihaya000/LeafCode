import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dataDir: "" }));

vi.mock("./paths", () => ({
  dataDir: () => h.dataDir,
  ensureDataDir: () => undefined,
}));

import { createTemporaryCopy, removeTemporaryCopy, temporaryCopyRoot } from "./copy";

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

function createOutwardDirectorySymlink(sourceRoot: string): string | null {
  const outsideTarget = tempDir("copy-outside-");
  const symlinkPath = path.join(sourceRoot, "escape-link");

  for (const type of ["dir", "junction"] as const) {
    try {
      fs.symlinkSync(outsideTarget, symlinkPath, type);
      return symlinkPath;
    } catch {
      try {
        fs.rmSync(symlinkPath, { recursive: true, force: true });
      } catch {
        // best effort cleanup before trying the next symlink type
      }
    }
  }

  return null;
}

describe("temporary copy isolation", () => {
  let sourceRoot: string;

  beforeEach(() => {
    h.dataDir = tempDir("copy-test-data-");
    sourceRoot = tempDir("copy-src-");
    fs.writeFileSync(path.join(sourceRoot, "regular.txt"), "copied");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of created.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort temp cleanup
      }
    }
  });

  it("removes outward symlinks from the copied tree while keeping regular files", () => {
    const symlinkPath = createOutwardDirectorySymlink(sourceRoot);
    if (!symlinkPath) return;
    const lstatSync = vi.spyOn(fs, "lstatSync");

    const dest = createTemporaryCopy(sourceRoot, "test-copy-1");

    expect(fs.existsSync(path.join(dest, "regular.txt"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "escape-link"))).toBe(false);
    expect(lstatSync).toHaveBeenCalledWith(path.join(dest, "escape-link"));
  });

  it("skips .leafcode directory to avoid bloating the copy", () => {
    // Create a .leafcode directory in the source root
    const webuiDir = path.join(sourceRoot, ".leafcode");
    fs.mkdirSync(webuiDir, { recursive: true });
    fs.writeFileSync(path.join(webuiDir, "data.json"), "should not be copied");

    const dest = createTemporaryCopy(sourceRoot, "test-copy-skip-webui");

    expect(fs.existsSync(path.join(dest, "regular.txt"))).toBe(true);
    expect(fs.existsSync(path.join(dest, ".leafcode"))).toBe(false);
  });

  it("rolls back only the exact destination when fs.cpSync fails", () => {
    const copiesRoot = temporaryCopyRoot();
    const siblingDest = path.join(copiesRoot, "test-copy-2-sibling");
    fs.mkdirSync(siblingDest, { recursive: true });
    fs.writeFileSync(path.join(siblingDest, "keep.txt"), "do not delete sibling");

    vi.spyOn(fs, "cpSync").mockImplementation((_src, dest) => {
      const partialDest = String(dest);
      fs.mkdirSync(partialDest, { recursive: true });
      fs.writeFileSync(path.join(partialDest, "partial.txt"), "partial copy");
      throw new Error("cp failed");
    });

    const failedDest = path.join(copiesRoot, "test-copy-2");

    expect(() => createTemporaryCopy(sourceRoot, "test-copy-2")).toThrow("cp failed");
    expect(fs.existsSync(failedDest)).toBe(false);
    expect(fs.existsSync(path.join(siblingDest, "keep.txt"))).toBe(true);
  });

  it("removeTemporaryCopy deletes the requested temporary copy without deleting a sibling", () => {
    const copiesRoot = temporaryCopyRoot();
    const dest = path.join(copiesRoot, "test-copy-3");
    const siblingDest = path.join(copiesRoot, "test-copy-30");
    fs.mkdirSync(dest, { recursive: true });
    fs.mkdirSync(siblingDest, { recursive: true });
    fs.writeFileSync(path.join(siblingDest, "keep.txt"), "do not delete sibling");

    removeTemporaryCopy(dest, "test-copy-3");

    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(path.join(siblingDest, "keep.txt"))).toBe(true);
  });

  it("removeTemporaryCopy rejects traversal into a sibling copy without deleting it", () => {
    const copiesRoot = temporaryCopyRoot();
    const copyA = path.join(copiesRoot, "copy-a");
    const copyB = path.join(copiesRoot, "copy-b");
    fs.mkdirSync(copyA, { recursive: true });
    fs.mkdirSync(copyB, { recursive: true });
    fs.writeFileSync(path.join(copyB, "keep.txt"), "do not delete copy-b");

    let thrown: unknown;
    try {
      removeTemporaryCopy(path.join(copyA, "..", "copy-b"), "copy-a");
    } catch (err) {
      thrown = err;
    }

    expect(fs.existsSync(path.join(copyB, "keep.txt"))).toBe(true);
    expect(thrown).toBeInstanceOf(Error);
  });
});
