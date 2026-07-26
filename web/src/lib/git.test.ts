import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dataDir: "" }));

vi.mock("./paths", () => ({
  dataDir: () => h.dataDir,
}));

import { assertSafeBranchName, gitWorktreeAdminDir, removeWorktree, runGit } from "./git";

describe("assertSafeBranchName", () => {
  it("accepts ordinary local and remote branch names", () => {
    expect(() => assertSafeBranchName("main")).not.toThrow();
    expect(() => assertSafeBranchName("origin/release-1.2")).not.toThrow();
    expect(() => assertSafeBranchName("機能/ログイン")).not.toThrow();
  });

  it("rejects option-like and traversal-like names", () => {
    expect(() => assertSafeBranchName("--force")).toThrow("invalid branch name");
    expect(() => assertSafeBranchName("feature/../main")).toThrow(
      "invalid branch name",
    );
    expect(() => assertSafeBranchName("a b")).toThrow("invalid branch name");
  });
});

describe("gitWorktreeAdminDir", () => {
  it("resolves a normal worktree to .git/worktrees/<basename>", () => {
    const repo = path.join("C:\\repo");
    const wt = path.join(repo, ".webui-worktrees", "task-abc");
    expect(gitWorktreeAdminDir(repo, wt)).toBe(
      path.join(repo, ".git", "worktrees", "task-abc"),
    );
  });

  it("does not resolve a path ending in .. to repo/.git", () => {
    const repo = path.join("C:\\repo");
    const crafted = path.join(repo, ".webui-worktrees", "missing", "foo", "..");
    const admin = gitWorktreeAdminDir(repo, crafted);
    expect(admin).not.toBeNull();
    expect(path.resolve(admin!)).not.toBe(path.resolve(repo, ".git"));
    expect(path.dirname(path.resolve(admin!))).toBe(
      path.resolve(repo, ".git", "worktrees"),
    );
  });
});

describe("removeWorktree path guard", () => {
  beforeEach(() => {
    h.dataDir = path.join("C:\\tmp", "git-test-data");
  });

  it("rejects the repo root even when it is nested under worktreeBase", async () => {
    const worktreeBase = path.join(h.dataDir, "worktrees");
    const repoRoot = path.join(worktreeBase, "repo");

    await expect(
      removeWorktree({ repoRoot, worktreePath: repoRoot }),
    ).rejects.toThrow("protected root");
  });

  it("rejects worktreeBase itself before the allow-list OR", async () => {
    const worktreeBase = path.join(h.dataDir, "worktrees");

    await expect(
      removeWorktree({
        repoRoot: path.join(worktreeBase, "repo"),
        worktreePath: worktreeBase,
      }),
    ).rejects.toThrow("protected root");
  });
});

describe("runGit timeout", () => {
  it("kills and rejects when git exceeds the timeout", async () => {
    // 1ms ceiling is shorter than any real git process start-up, so the timer
    // fires before `close`, proving a hung git cannot pin the worker forever.
    await expect(runGit(process.cwd(), ["status"], 1)).rejects.toThrow(/timed out/);
  });

  it("resolves normally within the timeout", async () => {
    const res = await runGit(process.cwd(), ["--version"], 30_000);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/git version/);
  });
});
