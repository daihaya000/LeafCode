// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync: execFileSyncMock }));

const existsSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({ existsSync: existsSyncMock }));

import { resolveNpmCli } from "./npm-cli";

describe("resolveNpmCli", () => {
  const originalNpmExecPath = process.env.npm_execpath;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.npm_execpath;
  });

  afterEach(() => {
    if (originalNpmExecPath === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = originalNpmExecPath;
  });

  it("prefers npm_execpath (the npm this process was launched with) when it exists on disk", () => {
    process.env.npm_execpath = "C:\\repo\\web\\node_modules\\npm-cli.js";
    existsSyncMock.mockImplementation((p: string) => p === process.env.npm_execpath);
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    });

    expect(resolveNpmCli()).toBe("C:\\repo\\web\\node_modules\\npm-cli.js");
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("falls back to where.exe npm.cmd when npm_execpath is unset/missing", () => {
    execFileSyncMock.mockReturnValue("C:\\nvm\\npm.cmd\n");
    existsSyncMock.mockImplementation(
      (p: string) => p === "C:\\nvm\\node_modules\\npm\\bin\\npm-cli.js",
    );

    expect(resolveNpmCli()).toBe("C:\\nvm\\node_modules\\npm\\bin\\npm-cli.js");
  });

  it("throws a descriptive error when no candidate exists on disk", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("where.exe: not found");
    });
    existsSyncMock.mockReturnValue(false);

    expect(() => resolveNpmCli()).toThrow(/npm-cli\.js/);
  });
});
