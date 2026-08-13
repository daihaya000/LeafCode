// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  readdir: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  stat: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  assertAllowedDirectory: vi.fn<
    (...args: unknown[]) => { ok: true; path: string } | { ok: false; error: string; status: number }
  >(() => ({ ok: true, path: "C:\\repos" })),
}));

vi.mock("node:fs/promises", () => ({
  default: {},
  readdir: (...a: unknown[]) => h.readdir(...a),
  stat: (...a: unknown[]) => h.stat(...a),
}));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (...a: unknown[]) => h.assertAllowedDirectory(...a),
}));

import { GET } from "./route";

function get(query = "") {
  return GET(
    new NextRequest(`http://localhost/api/git/repositories${query}`, {
      method: "GET",
      headers: { host: "127.0.0.1:3000" },
    }),
  );
}

function dirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAllowedDirectory.mockReturnValue({ ok: true, path: "C:\\repos" });
});

describe("GET /api/git/repositories", () => {
  it("requires a directory", async () => {
    const res = await get();
    expect(res.status).toBe(400);
  });

  it("rejects directories outside the allowlist", async () => {
    h.assertAllowedDirectory.mockReturnValue({
      ok: false,
      error: "not allowed",
      status: 403,
    });
    const res = await get("?directory=C%3A%5Cother");
    expect(res.status).toBe(403);
  });

  it("lists child directories that contain a .git entry, sorted by name", async () => {
    h.readdir.mockResolvedValue([
      dirent("repo-b", true),
      dirent("repo-a", true),
      dirent("plain", true),
      dirent("file.txt", false),
    ]);
    h.stat.mockImplementation(async (...args: unknown[]) => {
      const p = String(args[0]);
      if (p.endsWith("repo-a\\.git") || p.endsWith("repo-b\\.git")) {
        return { isDirectory: () => true, isFile: () => false };
      }
      throw new Error("ENOENT");
    });

    const res = await get("?directory=C%3A%5Crepos");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repositories).toEqual([
      { path: "C:\\repos\\repo-a", name: "repo-a" },
      { path: "C:\\repos\\repo-b", name: "repo-b" },
    ]);
  });

  it("includes the folder itself when it is a Git repository", async () => {
    h.readdir.mockResolvedValue([dirent("repo-a", true)]);
    h.stat.mockImplementation(async (...args: unknown[]) => {
      const p = String(args[0]);
      if (p.endsWith(".git")) {
        return { isDirectory: () => true, isFile: () => false };
      }
      throw new Error("ENOENT");
    });

    const res = await get("?directory=C%3A%5Crepos");
    const body = await res.json();
    expect(body.repositories[0]).toEqual({
      path: "C:\\repos",
      name: "repos",
    });
    expect(body.repositories).toHaveLength(2);
  });

  it("returns 400 when listing fails", async () => {
    h.readdir.mockRejectedValue(new Error("EACCES: permission denied"));
    const res = await get("?directory=C%3A%5Crepos");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("EACCES");
  });
});
