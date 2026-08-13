import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  runGit: vi.fn<(...args: unknown[]) => Promise<{ code: number; stdout: string; stderr: string }>>(
    async () => ({ code: 0, stdout: "", stderr: "" }),
  ),
  assertAllowedDirectory: vi.fn<
    (...args: unknown[]) =>
      | { ok: true; path: string }
      | { ok: false; status: number; error: string }
  >(() => ({ ok: true, path: "C:\\repo" })),
  invalidateDirStat: vi.fn<(...args: unknown[]) => void>(() => undefined),
}));

vi.mock("@/lib/git", () => ({
  runGit: (...a: unknown[]) => h.runGit(...a),
}));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (...a: unknown[]) => h.assertAllowedDirectory(...a),
}));
vi.mock("@/lib/dirstat", () => ({
  invalidateDirStat: (...a: unknown[]) => h.invalidateDirStat(...a),
}));

import { POST } from "./route";

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/git/init", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAllowedDirectory.mockReturnValue({ ok: true, path: "C:\\repo" });
  h.runGit.mockResolvedValue({ code: 0, stdout: "Initialized empty Git repository", stderr: "" });
});

describe("POST /api/git/init", () => {
  it("runs git init and invalidates the dir stat", async () => {
    const res = await post({ directory: "C:\\repo" });
    expect(res.status).toBe(200);
    expect(h.runGit).toHaveBeenCalledWith("C:\\repo", ["init"]);
    expect(h.invalidateDirStat).toHaveBeenCalledWith("C:\\repo");
  });

  it("is idempotent when the directory is already a repository", async () => {
    h.runGit.mockResolvedValue({
      code: 0,
      stdout: "Reinitialized existing Git repository in C:/repo/.git/",
      stderr: "",
    });
    const res = await post({ directory: "C:\\repo" });
    expect(res.status).toBe(200);
    expect(h.invalidateDirStat).toHaveBeenCalledWith("C:\\repo");
  });

  it("returns 400 when directory is missing", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("returns the allowlist error for a directory outside the roots", async () => {
    h.assertAllowedDirectory.mockReturnValue({
      ok: false,
      status: 403,
      error: "directory is outside allowed roots (or symlink escapes allowlist)",
    });
    const res = await post({ directory: "C:\\outside" });
    expect(res.status).toBe(403);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("returns 500 with stderr when git init fails", async () => {
    h.runGit.mockResolvedValue({ code: 1, stdout: "", stderr: "permission denied" });
    const res = await post({ directory: "C:\\repo" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "permission denied" });
    expect(h.invalidateDirStat).not.toHaveBeenCalled();
  });
});
