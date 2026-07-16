import { describe, expect, it } from "vitest";
import { makeWorktreeBranchName } from "./workspace-branch";

describe("makeWorktreeBranchName", () => {
  it("uses base branch, ascii slug, and workspace id prefix", () => {
    expect(
      makeWorktreeBranchName({
        displayName: "Fix login bug!",
        workspaceId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        baseBranch: "master",
      }),
    ).toBe("webui/master/fix-login-bug-a1b2c3d4");
  });

  it("falls back to task when title is non-ascii", () => {
    expect(
      makeWorktreeBranchName({
        displayName: "レスポンシブ改善",
        workspaceId: "deadbeef-0000-0000-0000-000000000001",
        baseBranch: "main",
      }),
    ).toBe("webui/main/task-deadbeef");
  });

  it("takes leaf of remote-tracking style base", () => {
    expect(
      makeWorktreeBranchName({
        displayName: "patch",
        workspaceId: "11223344-5566-7788-99aa-bbccddeeff00",
        baseBranch: "origin/develop",
      }),
    ).toBe("webui/develop/patch-11223344");
  });
});
