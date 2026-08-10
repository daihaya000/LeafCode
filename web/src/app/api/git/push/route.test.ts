import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  runGit: vi.fn<
    (...args: unknown[]) => Promise<{ code: number; stdout: string; stderr: string }>
  >(async () => ({ code: 0, stdout: "", stderr: "" })),
  assertAllowedDirectory: vi.fn<
    (...args: unknown[]) => { ok: true; path: string }
  >(() => ({ ok: true, path: "C:\\repo" })),
  invalidateDirStat: vi.fn<(...args: unknown[]) => void>(() => undefined),
}));

vi.mock("@/lib/git", () => ({ runGit: (...a: unknown[]) => h.runGit(...a) }));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (...a: unknown[]) => h.assertAllowedDirectory(...a),
}));
vi.mock("@/lib/dirstat", () => ({
  invalidateDirStat: (...a: unknown[]) => h.invalidateDirStat(...a),
}));

import { POST } from "./route";

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/git/push", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAllowedDirectory.mockReturnValue({ ok: true, path: "C:\\repo" });
  h.runGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
});

describe("POST /api/git/push", () => {
  it("requires a directory", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("rejects an invalid remote name", async () => {
    const res = await post({ directory: "C:\\repo", remote: "--evil" });
    expect(res.status).toBe(400);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("pushes HEAD to origin by default", async () => {
    h.runGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const res = await post({ directory: "C:\\repo" });
    expect(res.status).toBe(200);
    const args = h.runGit.mock.calls[0][1] as string[];
    expect(args[0]).toBe("push");
    expect(args).toContain("origin");
    expect(args).toContain("HEAD");
  });

  it("sets upstream on first push when requested", async () => {
    const res = await post({ directory: "C:\\repo", setUpstream: true });
    expect(res.status).toBe(200);
    const args = h.runGit.mock.calls[0][1] as string[];
    expect(args).toContain("-u");
  });

  it("uses force-with-lease when force is true", async () => {
    const res = await post({ directory: "C:\\repo", force: true });
    expect(res.status).toBe(200);
    const args = h.runGit.mock.calls[0][1] as string[];
    expect(args).toContain("--force-with-lease");
  });

  it("pushes a named branch", async () => {
    const res = await post({
      directory: "C:\\repo",
      branch: "feature/x",
      remote: "upstream",
    });
    expect(res.status).toBe(200);
    const args = h.runGit.mock.calls[0][1] as string[];
    expect(args).toContain("upstream");
    expect(args).toContain("feature/x");
  });

  it("rejects a branch name that looks like a refspec delete", async () => {
    const res = await post({
      directory: "C:\\repo",
      branch: ":refs/heads/main",
    });
    expect(res.status).toBe(400);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("rejects a branch starting with a dash", async () => {
    const res = await post({ directory: "C:\\repo", branch: "--all" });
    expect(res.status).toBe(400);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("returns 500 when git push fails", async () => {
    h.runGit.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "permission denied",
    });
    const res = await post({ directory: "C:\\repo" });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("permission denied");
  });

  it("invalidates the dir stat cache on success", async () => {
    await post({ directory: "C:\\repo" });
    expect(h.invalidateDirStat).toHaveBeenCalledWith("C:\\repo");
  });

  it("does not invalidate dir stat on failure", async () => {
    h.runGit.mockResolvedValue({ code: 1, stdout: "", stderr: "err" });
    await post({ directory: "C:\\repo" });
    expect(h.invalidateDirStat).not.toHaveBeenCalled();
  });

  it("extracts a human-readable summary from stdout", async () => {
    h.runGit.mockResolvedValue({
      code: 0,
      stdout:
        "Enumerating objects: 5, done.\n* branch-name -> origin/branch-name\nTo github.com:owner/repo.git\n",
      stderr: "",
    });
    const res = await post({ directory: "C:\\repo" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary).toBe("branch-name -> origin/branch-name");
  });
});