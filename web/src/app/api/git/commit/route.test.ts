import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  runGit: vi.fn(async (..._args: unknown[]) => ({ code: 0, stdout: "", stderr: "" })),
  assertAllowedDirectory: vi.fn((..._args: unknown[]) => ({ ok: true as const, path: "C:\\repo" })),
  invalidateDirStat: vi.fn((..._args: unknown[]) => undefined),
}));

vi.mock("@/lib/git", () => ({ runGit: (...a: unknown[]) => h.runGit(...a) }));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (...a: unknown[]) => h.assertAllowedDirectory(...a),
}));
vi.mock("@/lib/dirstat", () => ({
  invalidateDirStat: (...a: unknown[]) => h.invalidateDirStat(...a),
}));

import { POST } from "./route";
import { commitPathError } from "./path-guard";

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/git/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAllowedDirectory.mockReturnValue({ ok: true, path: "C:\\repo" });
  h.runGit.mockResolvedValue({ code: 0, stdout: "abc123 message", stderr: "" });
});

describe("commitPathError", () => {
  it("rejects broad and magic pathspecs", () => {
    expect(commitPathError(".")).toMatch(/unsafe/);
    expect(commitPathError("*")).toMatch(/unsafe/);
    expect(commitPathError("src/**")).toMatch(/unsafe/);
    expect(commitPathError(":(exclude)foo")).toMatch(/unsafe/);
    expect(commitPathError(":^foo")).toMatch(/unsafe/);
  });

  it("rejects WebUI metadata paths", () => {
    expect(commitPathError(".opencode-webui")).toMatch(/excluded/);
    expect(commitPathError(".opencode-webui/sessions.json")).toMatch(/excluded/);
    expect(commitPathError(".webui-worktrees\\wt1")).toMatch(/excluded/);
  });

  it("allows ordinary file paths", () => {
    expect(commitPathError("src/app.ts")).toBeNull();
    expect(commitPathError("README.md")).toBeNull();
  });
});

describe("POST /api/git/commit paths", () => {
  it("returns 400 for paths that would stage metadata", async () => {
    const res = await post({
      directory: "C:\\repo",
      message: "x",
      paths: [".opencode-webui/sessions.json"],
    });
    expect(res.status).toBe(400);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("returns 400 for paths: ['.'] instead of silently staging everything", async () => {
    const res = await post({
      directory: "C:\\repo",
      message: "x",
      paths: ["."],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unsafe path: ." });
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("stages and commits an allowed path list", async () => {
    const res = await post({
      directory: "C:\\repo",
      message: "fix",
      paths: ["src/a.ts"],
    });
    expect(res.status).toBe(200);
    expect(h.runGit).toHaveBeenCalledWith("C:\\repo", [
      "add",
      "--",
      "src/a.ts",
    ]);
  });
});
