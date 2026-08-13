import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  gitCommitFiles: vi.fn<
    (...args: unknown[]) => Promise<unknown[]>
  >(async () => []),
  gitCommitFileDiff: vi.fn<
    (...args: unknown[]) => Promise<string>
  >(async () => ""),
  assertAllowedDirectory: vi.fn<
    (...args: unknown[]) => { ok: true; path: string } | { ok: false; error: string; status: number }
  >(() => ({ ok: true, path: "C:\\repo" })),
}));

vi.mock("@/lib/git", () => ({
  gitCommitFiles: (...a: unknown[]) => h.gitCommitFiles(...a),
  gitCommitFileDiff: (...a: unknown[]) => h.gitCommitFileDiff(...a),
}));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (...a: unknown[]) => h.assertAllowedDirectory(...a),
}));

import { GET } from "./route";

function get(query = "") {
  return GET(
    new NextRequest(`http://localhost/api/git/show${query}`, {
      method: "GET",
      headers: { host: "127.0.0.1:3000" },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAllowedDirectory.mockReturnValue({ ok: true, path: "C:\\repo" });
  h.gitCommitFiles.mockResolvedValue([]);
  h.gitCommitFileDiff.mockResolvedValue("");
});

describe("GET /api/git/show", () => {
  it("requires a directory", async () => {
    const res = await get("?commit=abc123");
    expect(res.status).toBe(400);
  });

  it("requires a commit", async () => {
    const res = await get("?directory=C%3A%5Crepo");
    expect(res.status).toBe(400);
    expect(h.gitCommitFiles).not.toHaveBeenCalled();
  });

  it("rejects directories outside the allowlist", async () => {
    h.assertAllowedDirectory.mockReturnValue({
      ok: false,
      error: "not allowed",
      status: 403,
    });
    const res = await get("?directory=C%3A%5Cother&commit=abc123");
    expect(res.status).toBe(403);
    expect(h.gitCommitFiles).not.toHaveBeenCalled();
  });

  it("returns the commit file list when no file is given", async () => {
    h.gitCommitFiles.mockResolvedValue([
      { path: "src/a.ts", status: "M" },
      { path: "src/b.ts", status: "A" },
    ]);
    const res = await get("?directory=C%3A%5Crepo&commit=abc123");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commit).toBe("abc123");
    expect(body.files).toHaveLength(2);
    expect(h.gitCommitFiles).toHaveBeenCalledWith("C:\\repo", "abc123");
    expect(h.gitCommitFileDiff).not.toHaveBeenCalled();
  });

  it("returns the per-file diff when file is given", async () => {
    h.gitCommitFileDiff.mockResolvedValue("--- a/src/a.ts\n+++ b/src/a.ts\n");
    const res = await get("?directory=C%3A%5Crepo&commit=abc123&file=src%2Fa.ts");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commit).toBe("abc123");
    expect(body.diff).toContain("src/a.ts");
    expect(h.gitCommitFileDiff).toHaveBeenCalledWith("C:\\repo", "abc123", "src/a.ts");
    expect(h.gitCommitFiles).not.toHaveBeenCalled();
  });

  it("returns 400 when the git call fails", async () => {
    h.gitCommitFiles.mockRejectedValue(new Error("fatal: bad object"));
    const res = await get("?directory=C%3A%5Crepo&commit=bad");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("bad object");
  });
});
