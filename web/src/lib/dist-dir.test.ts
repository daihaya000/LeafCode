import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { resolveNextDistDir } from "./dist-dir";

const appDir = join("C:", "work", "repo", "web");

describe("resolveNextDistDir", () => {
  it("defaults to .next when NEXT_DIST_DIR is unset or blank", () => {
    expect(resolveNextDistDir({}, appDir)).toBe(".next");
    expect(resolveNextDistDir({ NEXT_DIST_DIR: "   " }, appDir)).toBe(".next");
  });

  it("converts an absolute same-drive directory to a relative distDir", () => {
    const abs = join("C:", "Users", "u", "AppData", "Roaming", "opencode-webui", "web-build");
    const rel = resolveNextDistDir({ NEXT_DIST_DIR: abs }, appDir);
    // The relative path must resolve back to the original absolute directory
    // once Next.js joins it with the app directory.
    expect(resolve(appDir, rel)).toBe(abs);
    expect(rel).toContain("..");
  });

  it("keeps relative inputs relative (e2e / dev behavior)", () => {
    expect(resolveNextDistDir({ NEXT_DIST_DIR: ".next-e2e" }, appDir)).toBe(".next-e2e");
    expect(resolveNextDistDir({ NEXT_DIST_DIR: ".next-dev" }, appDir)).toBe(".next-dev");
  });

  it("returns '.' when NEXT_DIST_DIR is the app directory itself", () => {
    expect(resolveNextDistDir({ NEXT_DIST_DIR: appDir }, appDir)).toBe(".");
  });

  it(
    "rejects a different drive on Windows (Next.js join cannot express it)",
    { skip: process.platform !== "win32" },
    () => {
      expect(() => resolveNextDistDir({ NEXT_DIST_DIR: "D:\\elsewhere\\build" }, appDir)).toThrow(
        /same drive/,
      );
    },
  );
});
