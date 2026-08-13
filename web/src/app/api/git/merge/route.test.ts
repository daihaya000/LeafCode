// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  runGit: vi.fn<
    (...args: unknown[]) => Promise<{ code: number; stdout: string; stderr: string }>
  >(async () => ({ code: 0, stdout: "", stderr: "" })),
  assertSafeBranchName: vi.fn<(...args: unknown[]) => void>(() => undefined),
  assertAllowedDirectory: vi.fn<
    (...args: unknown[]) => { ok: true; path: string } | { ok: false; error: string; status: number }
  >(() => ({ ok: true, path: "C:\\repo" })),
  assertNoActiveWorkflowForDirectory: vi.fn<(...args: unknown[]) => void>(() => undefined),
  invalidateDirStat: vi.fn<(...args: unknown[]) => void>(() => undefined),
}));

vi.mock("@/lib/git", () => ({
  runGit: (...a: unknown[]) => h.runGit(...a),
  assertSafeBranchName: (...a: unknown[]) => h.assertSafeBranchName(...a),
}));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (...a: unknown[]) => h.assertAllowedDirectory(...a),
}));
vi.mock("@/lib/dirstat", () => ({
  invalidateDirStat: (...a: unknown[]) => h.invalidateDirStat(...a),
}));
vi.mock("@/lib/workflow-service", () => ({
  assertNoActiveWorkflowForDirectory: (...a: unknown[]) =>
    h.assertNoActiveWorkflowForDirectory(...a),
  WorkflowServiceError: class WorkflowServiceError extends Error {
    status = 409;
  },
}));

import { POST } from "./route";

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/git/merge", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAllowedDirectory.mockReturnValue({ ok: true, path: "C:\\repo" });
  h.assertSafeBranchName.mockImplementation(() => undefined);
  h.assertNoActiveWorkflowForDirectory.mockImplementation(() => undefined);
  h.runGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
});

describe("POST /api/git/merge", () => {
  it("requires a directory and branch", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("rejects unsafe branch names", async () => {
    h.assertSafeBranchName.mockImplementation(() => {
      throw new Error("unsafe branch name");
    });
    const res = await post({ directory: "C:\\repo", branch: "--evil" });
    expect(res.status).toBe(400);
  });

  it("rejects directories outside the allowlist", async () => {
    h.assertAllowedDirectory.mockReturnValue({
      ok: false,
      error: "not allowed",
      status: 403,
    });
    const res = await post({ directory: "C:\\other", branch: "main" });
    expect(res.status).toBe(403);
  });

  it("merges the branch into the current branch", async () => {
    h.runGit
      .mockResolvedValueOnce({ code: 0, stdout: "feature/x\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "Merge made by the 'ort' strategy.\n", stderr: "" });
    const res = await post({ directory: "C:\\repo", branch: "feature/x" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.merged).toBe("feature/x");
    expect(body.into).toBe("feature/x");
    const args = h.runGit.mock.calls[1][1] as string[];
    expect(args[0]).toBe("merge");
    expect(args).toContain("feature/x");
    expect(h.invalidateDirStat).toHaveBeenCalledWith("C:\\repo");
  });

  it("uses --no-ff and a message when requested", async () => {
    h.runGit
      .mockResolvedValueOnce({ code: 0, stdout: "feature/x\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    await post({ directory: "C:\\repo", branch: "feature/x", noFf: true, message: "Merge pull" });
    const args = h.runGit.mock.calls[1][1] as string[];
    expect(args).toContain("--no-ff");
    expect(args).toContain("-m");
    expect(args).toContain("Merge pull");
  });

  it("returns 409 with an aborted merge on conflict", async () => {
    h.runGit
      .mockResolvedValueOnce({ code: 0, stdout: "feature/x\n", stderr: "" })
      .mockResolvedValueOnce({
        code: 1,
        stdout: "CONFLICT (content): Merge conflict in a.ts",
        stderr: "",
      })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const res = await post({ directory: "C:\\repo", branch: "feature/x" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflict).toBe(true);
    const abortArgs = h.runGit.mock.calls[2][1] as string[];
    expect(abortArgs).toEqual(["merge", "--abort"]);
  });

  it("merges into a target branch and restores the original branch", async () => {
    h.runGit
      .mockResolvedValueOnce({ code: 0, stdout: "feature/x\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // checkout main
      .mockResolvedValueOnce({ code: 0, stdout: "Updating main\n", stderr: "" }) // merge feature/x
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // checkout feature/x
    const res = await post({
      directory: "C:\\repo",
      branch: "main",
      into: "branch",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.merged).toBe("feature/x");
    expect(body.into).toBe("main");
    expect(body.restored).toBe("feature/x");
    expect(h.runGit.mock.calls[1][1]).toEqual(["checkout", "main"]);
    expect(h.runGit.mock.calls[3][1]).toEqual(["checkout", "feature/x"]);
  });

  it("returns 409 when the merge target is checked out in another worktree", async () => {
    h.runGit
      .mockResolvedValueOnce({ code: 0, stdout: "feature/x\n", stderr: "" })
      .mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "fatal: 'main' is already checked out at 'C:/main'",
      });
    const res = await post({
      directory: "C:\\repo",
      branch: "main",
      into: "branch",
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.worktreeConflict).toBe(true);
  });
});
