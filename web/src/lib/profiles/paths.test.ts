import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isInside,
  isValidProfileName,
  MAX_PROFILE_NAME_LENGTH,
  resolveSlug,
  samePath,
  toSlug,
} from "./paths";

describe("toSlug", () => {
  it("normalises a plain label", () => {
    expect(toSlug("Work Setup")).toBe("work-setup");
  });

  it("never emits path separators or traversal", () => {
    for (const evil of ["../escape", "..\\escape", "a/b", "a\\b", "..", "."]) {
      const slug = toSlug(evil);
      expect(slug).not.toContain("/");
      expect(slug).not.toContain("\\");
      expect(slug).not.toBe("..");
      expect(slug).not.toBe(".");
    }
  });

  it("falls back for labels with no ASCII (e.g. Japanese)", () => {
    expect(toSlug("実験用")).toBe("profile");
  });

  it("defuses Windows device names", () => {
    for (const reserved of ["CON", "nul", "com1", "LPT9", "aux.txt"]) {
      expect(toSlug(reserved).startsWith("profile-")).toBe(true);
    }
  });

  it("bounds the slug length", () => {
    expect(toSlug("a".repeat(200)).length).toBeLessThanOrEqual(48);
  });
});

describe("resolveSlug", () => {
  it("returns the base slug when free", () => {
    expect(resolveSlug("work", [])).toBe("work");
  });

  it("suffixes on collision", () => {
    expect(resolveSlug("work", ["work"])).toBe("work-2");
    expect(resolveSlug("work", ["work", "work-2"])).toBe("work-3");
  });

  it("compares case-insensitively", () => {
    expect(resolveSlug("Work", ["WORK"])).toBe("work-2");
  });
});

describe("isValidProfileName", () => {
  it("accepts ordinary labels including Japanese", () => {
    expect(isValidProfileName("実験用")).toBe(true);
    expect(isValidProfileName("work")).toBe(true);
  });

  it("rejects empty, overlong and control characters", () => {
    expect(isValidProfileName("")).toBe(false);
    expect(isValidProfileName("   ")).toBe(false);
    expect(isValidProfileName("a".repeat(MAX_PROFILE_NAME_LENGTH + 1))).toBe(false);
    expect(isValidProfileName("bad\u0000name")).toBe(false);
    expect(isValidProfileName(42)).toBe(false);
  });
});

describe("samePath", () => {
  it("ignores case on Windows", () => {
    const a = path.join("C:", "Users", "x", "profile");
    const b = path.join("c:", "users", "x", "PROFILE");
    expect(samePath(a, b)).toBe(process.platform === "win32");
  });

  it("normalises separators and traversal", () => {
    expect(samePath("/tmp/a/../a", "/tmp/a")).toBe(true);
  });
});

describe("isInside", () => {
  it("accepts descendants and rejects escapes", () => {
    const root = path.resolve("/tmp/profiles");
    expect(isInside(root, path.join(root, "work"))).toBe(true);
    expect(isInside(root, path.join(root, "..", "elsewhere"))).toBe(false);
    expect(isInside(root, root)).toBe(false);
  });
});
