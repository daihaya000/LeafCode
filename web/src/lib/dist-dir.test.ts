import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { resolveNextDistDir } from "./dist-dir";

const appDir = join("C:", "work", "repo", "web");

describe("resolveNextDistDir", () => {
  it("defaults to .next when NEXT_DIST_DIR is unset or blank", () => {
    expect(resolveNextDistDir({}, appDir)).toBe(".next");
    expect(resolveNextDistDir({ NEXT_DIST_DIR: "   " }, appDir)).toBe(".next");
  });

  it("accepts an absolute path inside the app directory and returns it relative", () => {
    const abs = join(appDir, ".next-e2e");
    const rel = resolveNextDistDir({ NEXT_DIST_DIR: abs }, appDir);
    expect(rel).toBe(".next-e2e");
    expect(resolve(appDir, rel)).toBe(abs);
  });

  it("rejects a directory outside the app: Turbopack refuses to build there", () => {
    const outside = join("C:", "Users", "u", "AppData", "Roaming", "opencode-webui", "web-build");
    expect(() => resolveNextDistDir({ NEXT_DIST_DIR: outside }, appDir)).toThrow(
      /must be inside the web app/,
    );
    expect(() => resolveNextDistDir({ NEXT_DIST_DIR: ".." }, appDir)).toThrow(
      /must be inside the web app/,
    );
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
        /must be inside the web app/,
      );
    },
  );
});
