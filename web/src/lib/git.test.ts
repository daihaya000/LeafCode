import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dataDir: "" }));

vi.mock("./paths", () => ({
  dataDir: () => h.dataDir,
}));

import { assertSafeBranchName, removeWorktree } from "./git";

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
