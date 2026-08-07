import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const existsSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({ existsSync: existsSyncMock, default: { existsSync: existsSyncMock } }));

import { installationRoot, isGitInstall } from "./install-root";

describe("installationRoot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENCODE_WEBUI_INSTALL_ROOT;
  });

  it("prefers OPENCODE_WEBUI_INSTALL_ROOT so a mirrored server still targets the install", () => {
    existsSyncMock.mockReturnValue(true);
    process.env.OPENCODE_WEBUI_INSTALL_ROOT = join("C:", "repo", "OpenCodeWebUI");
    expect(installationRoot()).toBe(resolve(join("C:", "repo", "OpenCodeWebUI")));
    expect(existsSyncMock).not.toHaveBeenCalled();
  });

  it("ignores a blank OPENCODE_WEBUI_INSTALL_ROOT", () => {
    existsSyncMock.mockImplementation((p: unknown) => String(p).endsWith("scripts"));
    process.env.OPENCODE_WEBUI_INSTALL_ROOT = "   ";
    expect(installationRoot()).toBe(resolve(process.cwd(), ".."));
  });

  it("returns the parent directory when it contains a scripts folder", () => {
    existsSyncMock.mockImplementation((p: unknown) => String(p).endsWith("scripts"));
    const expected = resolve(process.cwd(), "..");
    expect(installationRoot()).toBe(expected);
    expect(existsSyncMock).toHaveBeenCalledWith(join(expected, "scripts"));
  });

  it("falls back to process.cwd() when the parent has no scripts folder", () => {
    existsSyncMock.mockReturnValue(false);
    expect(installationRoot()).toBe(process.cwd());
  });
});

describe("isGitInstall", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is true when <root>/.git exists", () => {
    existsSyncMock.mockReturnValue(true);
    expect(isGitInstall("C:\\repo")).toBe(true);
    expect(existsSyncMock).toHaveBeenCalledWith(join("C:\\repo", ".git"));
  });

  it("is false when <root>/.git is absent", () => {
    existsSyncMock.mockReturnValue(false);
    expect(isGitInstall("C:\\repo")).toBe(false);
  });
});
