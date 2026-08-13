import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  gitLogGraph: vi.fn<
    (...args: unknown[]) => Promise<{ commits: unknown[]; hasMore: boolean }>
  >(async () => ({ commits: [], hasMore: false })),
  gitBranchRefs: vi.fn<
    (...args: unknown[]) => Promise<{ refs: unknown[]; currentBranch: string | null }>
  >(async () => ({ refs: [], currentBranch: null })),
  assertAllowedDirectory: vi.fn<
    (...args: unknown[]) => { ok: true; path: string } | { ok: false; error: string; status: number }
  >(() => ({ ok: true, path: "C:\\repo" })),
}));

vi.mock("@/lib/git", () => ({
  gitLogGraph: (...a: unknown[]) => h.gitLogGraph(...a),
  gitBranchRefs: (...a: unknown[]) => h.gitBranchRefs(...a),
}));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (...a: unknown[]) => h.assertAllowedDirectory(...a),
}));

import { GET } from "./route";

function get(query = "") {
  return GET(
    new NextRequest(`http://localhost/api/git/log${query}`, {
      method: "GET",
      headers: { host: "127.0.0.1:3000" },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAllowedDirectory.mockReturnValue({ ok: true, path: "C:\\repo" });
  h.gitLogGraph.mockResolvedValue({ commits: [], hasMore: false });
  h.gitBranchRefs.mockResolvedValue({ refs: [], currentBranch: null });
});

describe("GET /api/git/log", () => {
  it("requires a directory", async () => {
    const res = await get();
    expect(res.status).toBe(400);
    expect(h.gitLogGraph).not.toHaveBeenCalled();
  });

  it("rejects directories outside the allowlist", async () => {
    h.assertAllowedDirectory.mockReturnValue({
      ok: false,
      error: "not allowed",
      status: 403,
    });
    const res = await get("?directory=C%3A%5Cother");
    expect(res.status).toBe(403);
    expect(h.gitLogGraph).not.toHaveBeenCalled();
  });

  it("returns commits, refs, currentBranch and hasMore", async () => {
    h.gitLogGraph.mockResolvedValue({
      commits: [{ hash: "abc123", subject: "fix" }],
      hasMore: true,
    });
    h.gitBranchRefs.mockResolvedValue({
      refs: ["main", "feature/x"],
      currentBranch: "main",
    });
    const res = await get("?directory=C%3A%5Crepo");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commits).toEqual([{ hash: "abc123", subject: "fix" }]);
    expect(body.refs).toEqual(["main", "feature/x"]);
    expect(body.currentBranch).toBe("main");
    expect(body.hasMore).toBe(true);
  });

  it("passes limit and skip to the graph loader", async () => {
    await get("?directory=C%3A%5Crepo&limit=30&skip=10");
    expect(h.gitLogGraph).toHaveBeenCalledWith("C:\\repo", 30, 10);
  });

  it("defaults limit to 80 and skip to 0", async () => {
    await get("?directory=C%3A%5Crepo");
    expect(h.gitLogGraph).toHaveBeenCalledWith("C:\\repo", 80, 0);
  });

  it("returns 400 with an empty payload when the graph load fails", async () => {
    h.gitLogGraph.mockRejectedValue(new Error("fatal: not a git repository"));
    const res = await get("?directory=C%3A%5Crepo");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not a git repository");
    expect(body.commits).toEqual([]);
    expect(body.refs).toEqual([]);
    expect(body.hasMore).toBe(false);
  });
});
