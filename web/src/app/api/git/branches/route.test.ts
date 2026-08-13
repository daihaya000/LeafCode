import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  runGit: vi.fn<
    (...args: unknown[]) => Promise<{ code: number; stdout: string; stderr: string }>
  >(async () => ({ code: 0, stdout: "", stderr: "" })),
  assertAllowedDirectory: vi.fn<
    (...args: unknown[]) => { ok: true; path: string } | { ok: false; error: string; status: number }
  >(() => ({ ok: true, path: "C:\\repo" })),
}));

vi.mock("@/lib/git", () => ({ runGit: (...a: unknown[]) => h.runGit(...a) }));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (...a: unknown[]) => h.assertAllowedDirectory(...a),
}));

import { GET } from "./route";

function get(query = "") {
  return GET(
    new NextRequest(`http://localhost/api/git/branches${query}`, {
      method: "GET",
      headers: { host: "127.0.0.1:3000" },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAllowedDirectory.mockReturnValue({ ok: true, path: "C:\\repo" });
  h.runGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
});

describe("GET /api/git/branches", () => {
  it("requires a directory", async () => {
    const res = await get();
    expect(res.status).toBe(400);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("rejects directories outside the allowlist", async () => {
    h.assertAllowedDirectory.mockReturnValue({
      ok: false,
      error: "not allowed",
      status: 403,
    });
    const res = await get("?directory=C%3A%5Cother");
    expect(res.status).toBe(403);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("returns current branch, list, upstream and remotes", async () => {
    h.runGit
      .mockResolvedValueOnce({ code: 0, stdout: "main\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "main\nfeature/x\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "origin/main\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "2\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "origin\nupstream\n", stderr: "" });

    const res = await get("?directory=C%3A%5Crepo");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.current).toBe("main");
    expect(body.branches).toEqual(["main", "feature/x"]);
    expect(body.upstream).toBe("origin/main");
    expect(body.ahead).toBe(2);
    expect(body.remotes).toEqual(["origin", "upstream"]);
    expect(body.hasRemote).toBe(true);
  });

  it("falls back to main as defaultTarget and never targets the current branch", async () => {
    h.runGit
      .mockResolvedValueOnce({ code: 0, stdout: "feature/x\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "main\nfeature/x\n", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "no upstream" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "no upstream" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const res = await get("?directory=C%3A%5Crepo");
    const body = await res.json();
    expect(body.current).toBe("feature/x");
    expect(body.defaultTarget).toBe("main");
    expect(body.upstream).toBeNull();
    expect(body.ahead).toBe(-1);
  });

  it("returns null defaultTarget when the only branch is current", async () => {
    h.runGit
      .mockResolvedValueOnce({ code: 0, stdout: "main\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "main\n", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "origin\n", stderr: "" });

    const res = await get("?directory=C%3A%5Crepo");
    const body = await res.json();
    expect(body.defaultTarget).toBeNull();
  });

  it("returns an error when the repo has no HEAD", async () => {
    h.runGit.mockResolvedValueOnce({ code: 128, stdout: "", stderr: "fatal: not a git repository" });
    const res = await get("?directory=C%3A%5Crepo");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not a git repository");
  });
});
