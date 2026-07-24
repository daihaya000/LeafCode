import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExtensionsError,
  assertValidEntryName,
  moveEntrySafe,
  resolveContainedPath,
} from "./safe-move";

let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "safe-move-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(base, { recursive: true, force: true });
});

describe("assertValidEntryName", () => {
  it("accepts plain skill/plugin names", () => {
    expect(() => assertValidEntryName("insane-search")).not.toThrow();
    expect(() => assertValidEntryName("cursor-acp.js")).not.toThrow();
    expect(() => assertValidEntryName("model-fallback.ts")).not.toThrow();
    expect(() => assertValidEntryName("0num")).not.toThrow();
  });

  it.each([
    ["empty", ""],
    ["dot", "."],
    ["dotdot", ".."],
    ["parent escape", "../skills"],
    ["posix separator", "a/b"],
    ["win separator", "a\\b"],
    ["hidden", ".secret"],
    ["control char", "a\x00b"],
    ["colon", "a:b"],
    ["trailing dot", "name."],
    ["trailing space", "name "],
    ["reserved", "CON"],
    ["reserved with ext", "com1.txt"],
    ["too long", "x".repeat(256)],
  ])("rejects %s", (_label, name) => {
    expect(() => assertValidEntryName(name)).toThrowError(ExtensionsError);
    try {
      assertValidEntryName(name);
    } catch (err) {
      expect((err as ExtensionsError).code).toBe("invalid-name");
    }
  });

  it("rejects non-string values", () => {
    expect(() => assertValidEntryName(undefined)).toThrowError(ExtensionsError);
    expect(() => assertValidEntryName(42)).toThrowError(ExtensionsError);
  });
});

describe("resolveContainedPath", () => {
  it("resolves a name directly under the parent", () => {
    const out = resolveContainedPath(base, "my-skill");
    expect(out).toBe(path.join(path.resolve(base), "my-skill"));
  });

  it("never escapes the parent even for crafted names", () => {
    expect(() => resolveContainedPath(base, "..")).toThrowError(ExtensionsError);
    expect(() => resolveContainedPath(base, "../escape")).toThrowError(
      ExtensionsError,
    );
    expect(() => resolveContainedPath(base, "a/b")).toThrowError(ExtensionsError);
  });
});

describe("moveEntrySafe (directory)", () => {
  it("moves a directory to a new location", async () => {
    const src = path.join(base, "skills", "foo");
    const dst = path.join(base, "skills-disabled", "foo");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "SKILL.md"), "---\nname: foo\n---\n");

    await moveEntrySafe(src, dst, "dir");

    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(path.join(dst, "SKILL.md"), "utf8")).toContain(
      "name: foo",
    );
  });

  it("creates missing parent directories at the destination", async () => {
    const src = path.join(base, "a");
    fs.mkdirSync(src);
    const dst = path.join(base, "deep", "nested", "a");
    await moveEntrySafe(src, dst, "dir");
    expect(fs.existsSync(dst)).toBe(true);
  });

  it("fails with conflict and keeps the source when the target exists", async () => {
    const src = path.join(base, "skills", "foo");
    const dst = path.join(base, "skills-disabled", "foo");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "SKILL.md"), "src");
    fs.mkdirSync(dst, { recursive: true });
    fs.writeFileSync(path.join(dst, "SKILL.md"), "dst");

    await expect(moveEntrySafe(src, dst, "dir")).rejects.toMatchObject({
      code: "conflict",
    });

    // Both trees untouched — nothing lost.
    expect(fs.readFileSync(path.join(src, "SKILL.md"), "utf8")).toBe("src");
    expect(fs.readFileSync(path.join(dst, "SKILL.md"), "utf8")).toBe("dst");
  });

  it("reports not-found when the source is missing", async () => {
    await expect(
      moveEntrySafe(path.join(base, "nope"), path.join(base, "x"), "dir"),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("refuses to move a file when a directory is expected", async () => {
    const src = path.join(base, "file.txt");
    fs.writeFileSync(src, "x");
    await expect(
      moveEntrySafe(src, path.join(base, "out"), "dir"),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("falls back to copy+remove across volumes (EXDEV)", async () => {
    const src = path.join(base, "skills", "foo");
    const dst = path.join(base, "skills-disabled", "foo");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "SKILL.md"), "data");

    vi.spyOn(fs.promises, "rename").mockImplementationOnce((() => {
      const err = new Error("cross-device link") as NodeJS.ErrnoException;
      err.code = "EXDEV";
      return Promise.reject(err);
    }) as typeof fs.promises.rename);

    await moveEntrySafe(src, dst, "dir");

    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(path.join(dst, "SKILL.md"), "utf8")).toBe("data");
  });

  it("keeps the source when the cross-volume copy fails", async () => {
    const src = path.join(base, "skills", "foo");
    const dst = path.join(base, "skills-disabled", "foo");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "SKILL.md"), "data");

    vi.spyOn(fs.promises, "rename").mockImplementationOnce(() => {
      const err = new Error("cross-device link") as NodeJS.ErrnoException;
      err.code = "EXDEV";
      return Promise.reject(err);
    });
    vi.spyOn(fs.promises, "cp").mockImplementationOnce(() =>
      Promise.reject(new Error("disk full")),
    );

    await expect(moveEntrySafe(src, dst, "dir")).rejects.toMatchObject({
      code: "io",
    });
    expect(fs.existsSync(path.join(src, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(dst)).toBe(false);
  });

  it("maps a racing EEXIST from rename to conflict", async () => {
    const src = path.join(base, "skills", "foo");
    const dst = path.join(base, "skills-disabled", "foo");
    fs.mkdirSync(src, { recursive: true });

    vi.spyOn(fs.promises, "rename").mockImplementationOnce(() => {
      const err = new Error("exists") as NodeJS.ErrnoException;
      err.code = "EEXIST";
      return Promise.reject(err);
    });

    await expect(moveEntrySafe(src, dst, "dir")).rejects.toMatchObject({
      code: "conflict",
    });
    expect(fs.existsSync(src)).toBe(true);
  });
});

describe("moveEntrySafe (file)", () => {
  it("moves a file", async () => {
    const src = path.join(base, "plugin", "a.js");
    const dst = path.join(base, "plugin-disabled", "a.js");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, "export default {}");

    await moveEntrySafe(src, dst, "file");

    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(dst, "utf8")).toBe("export default {}");
  });

  it("fails with conflict when the target file exists", async () => {
    const src = path.join(base, "plugin", "a.js");
    const dst = path.join(base, "plugin-disabled", "a.js");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(src, "src");
    fs.writeFileSync(dst, "dst");

    await expect(moveEntrySafe(src, dst, "file")).rejects.toMatchObject({
      code: "conflict",
    });
    expect(fs.readFileSync(src, "utf8")).toBe("src");
    expect(fs.readFileSync(dst, "utf8")).toBe("dst");
  });
});
