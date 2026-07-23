import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveValidatedAllowlistPath } from "./path-validation";

describe("resolveValidatedAllowlistPath", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    ["UNC", "C:\\allowlist-source", "\\\\localhost\\C$\\Windows"],
    ["extended device", "C:\\allowlist-source", "\\\\?\\C:\\Windows"],
    ["device namespace", "C:\\allowlist-source", "\\\\.\\C:\\Windows"],
  ])("rejects a canonical %s path", (_kind, rawPath, canonicalPath) => {
    const nativeRealpath = fs.realpathSync.native;
    vi.spyOn(fs.realpathSync, "native").mockImplementation((input) =>
      input === rawPath ? canonicalPath : nativeRealpath(input),
    );

    expect(resolveValidatedAllowlistPath(rawPath)).toEqual({
      error: "UNCまたはデバイスパスは許可リストに追加できません",
    });
  });

  it.each(["C:\\", "D:\\", "Z:\\"])(
    "rejects canonical drive root %s",
    (canonicalPath) => {
      const rawPath = "C:\\allowlist-source";
      const nativeRealpath = fs.realpathSync.native;
      vi.spyOn(fs.realpathSync, "native").mockImplementation((input) =>
        input === rawPath ? canonicalPath : nativeRealpath(input),
      );
      vi.spyOn(fs, "statSync").mockReturnValue({
        isDirectory: () => true,
      } as fs.Stats);

      expect(resolveValidatedAllowlistPath(rawPath)).toEqual({
        error: "ドライブルートは許可リストに追加できません",
      });
    },
  );

  it.each([
    "SystemRoot",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "ProgramData",
  ])("rejects descendants of the %s environment location", (variable) => {
    const protectedPath = fs.mkdtempSync(path.join(os.tmpdir(), "protected-"));
    const candidate = path.join(protectedPath, "child");
    fs.mkdirSync(candidate);
    vi.stubEnv(variable, protectedPath);

    expect(resolveValidatedAllowlistPath(candidate)).toHaveProperty("error");
    fs.rmSync(protectedPath, { recursive: true, force: true });
  });

  it("rejects every profile below USERPROFILE's parent", () => {
    const profileParent = fs.mkdtempSync(path.join(os.tmpdir(), "profiles-"));
    const currentProfile = path.join(profileParent, "current-user");
    const otherProfile = path.join(profileParent, "other-user");
    fs.mkdirSync(currentProfile);
    fs.mkdirSync(otherProfile);
    vi.stubEnv("USERPROFILE", currentProfile);

    expect(resolveValidatedAllowlistPath(otherProfile)).toHaveProperty("error");
    fs.rmSync(profileParent, { recursive: true, force: true });
  });
});
