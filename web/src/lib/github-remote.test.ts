// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { parseLsRemoteSymrefOutput, resolveRemoteHead } from "./github-remote";

describe("parseLsRemoteSymrefOutput", () => {
  it("extracts the default branch and commit from a real `git ls-remote --symref` transcript", () => {
    const stdout =
      "ref: refs/heads/master\tHEAD\ne871d3765129eef9bbc5f4e83f4489867970ae1d\tHEAD\n";
    expect(parseLsRemoteSymrefOutput(stdout)).toEqual({
      branch: "master",
      commit: "e871d3765129eef9bbc5f4e83f4489867970ae1d",
    });
  });

  it("works for a `main` default branch too", () => {
    const stdout = "ref: refs/heads/main\tHEAD\nabc1234\tHEAD\n";
    expect(parseLsRemoteSymrefOutput(stdout)).toEqual({ branch: "main", commit: "abc1234" });
  });

  it("returns null when the output is unparsable", () => {
    expect(parseLsRemoteSymrefOutput("")).toBeNull();
    expect(parseLsRemoteSymrefOutput("not a git output")).toBeNull();
  });
});

describe("resolveRemoteHead", () => {
  it("throws a descriptive error when git's output can't be parsed", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, { stdout: "garbage", stderr: "" });
    });
    await expect(resolveRemoteHead("https://example.invalid/repo.git")).rejects.toThrow(
      /解析できませんでした/,
    );
  });

  it("resolves branch/commit from a well-formed transcript", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, { stdout: "ref: refs/heads/master\tHEAD\ndeadbeef\tHEAD\n", stderr: "" });
    });
    await expect(resolveRemoteHead("https://example.invalid/repo.git")).resolves.toEqual({
      branch: "master",
      commit: "deadbeef",
    });
  });
});
