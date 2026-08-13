// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  spawn: vi.fn(),
  runGit: vi.fn<
    (...args: unknown[]) => Promise<{ code: number; stdout: string; stderr: string }>
  >(async () => ({ code: 0, stdout: "", stderr: "" })),
  assertSafeBranchName: vi.fn<(...args: unknown[]) => void>(() => undefined),
  assertAllowedDirectory: vi.fn<
    (...args: unknown[]) => { ok: true; path: string } | { ok: false; error: string; status: number }
  >(() => ({ ok: true, path: "C:\\repo" })),
}));

vi.mock("node:child_process", () => ({
  spawn: (...a: unknown[]) => h.spawn(...a),
}));
vi.mock("@/lib/git", () => ({
  runGit: (...a: unknown[]) => h.runGit(...a),
  assertSafeBranchName: (...a: unknown[]) => h.assertSafeBranchName(...a),
}));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (...a: unknown[]) => h.assertAllowedDirectory(...a),
}));

import { GET, POST } from "./route";

type FakeChild = {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  on: (event: string, cb: (...a: unknown[]) => void) => FakeChild;
  emitError: (err: Error) => void;
};

function fakeChild(closeCode: number, stdout = "", stderr = "", emitError = false): FakeChild {
  const out = new EventEmitter();
  const errE = new EventEmitter();
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const child = {
    stdout: out,
    stderr: errE,
    kill: vi.fn(),
    on: (event: string, cb: (...a: unknown[]) => void) => {
      handlers[event] = cb;
      return child;
    },
    emitError: (err: Error) => {
      handlers["error"]?.(err);
    },
  };
  setImmediate(() => {
    if (emitError) {
      child.emitError(new Error("spawn gh ENOENT"));
      return;
    }
    if (stdout) out.emit("data", stdout);
    if (stderr) errE.emit("data", stderr);
    handlers["close"]?.(closeCode);
  });
  return child;
}

function get(query = "") {
  return GET(
    new NextRequest(`http://localhost/api/git/pr${query}`, {
      method: "GET",
      headers: { host: "127.0.0.1:3000" },
    }),
  );
}

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/git/pr", {
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
  h.runGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
});

describe("GET /api/git/pr", () => {
  it("reports gh availability with its version", async () => {
    h.spawn.mockImplementation(() =>
      fakeChild(0, "gh version 2.45.0 (2024-01-01)\nhttps://github.com/cli/cli/releases/tag/v2.45.0"),
    );
    const res = await get("?directory=C%3A%5Crepo");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.version).toBe("gh version 2.45.0 (2024-01-01)");
  });

  it("reports unavailable with a hint when gh is missing", async () => {
    h.spawn.mockImplementation(() => fakeChild(1, "", "", true));
    const res = await get();
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.hint).toContain("gh auth login");
  });
});

describe("POST /api/git/pr", () => {
  it("requires a directory and title", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("rejects directories outside the allowlist", async () => {
    h.assertAllowedDirectory.mockReturnValue({
      ok: false,
      error: "not allowed",
      status: 403,
    });
    const res = await post({ directory: "C:\\other", title: "Fix" });
    expect(res.status).toBe(403);
  });

  it("rejects an unsafe base branch name", async () => {
    h.assertSafeBranchName.mockImplementation(() => {
      throw new Error("unsafe branch name");
    });
    const res = await post({ directory: "C:\\repo", title: "Fix", base: "--evil" });
    expect(res.status).toBe(400);
  });

  it("returns 503 when gh is not installed", async () => {
    h.spawn.mockImplementation(() => fakeChild(1, "", "", true));
    const res = await post({ directory: "C:\\repo", title: "Fix" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.hint).toContain("gh auth login");
  });

  it("returns 500 when the push fails", async () => {
    h.spawn.mockImplementation(() => fakeChild(0, "gh version 2.45.0"));
    h.runGit.mockResolvedValue({ code: 1, stdout: "", stderr: "fatal: could not read Username" });
    const res = await post({ directory: "C:\\repo", title: "Fix" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("could not read Username");
  });

  it("creates the PR and returns its URL", async () => {
    h.spawn.mockImplementation(() =>
      fakeChild(0, "https://github.com/owner/repo/pull/42\n"),
    );
    const res = await post({ directory: "C:\\repo", title: "Fix", body: "Details", base: "main" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.url).toBe("https://github.com/owner/repo/pull/42");

    const pushArgs = h.runGit.mock.calls[0][1] as string[];
    expect(pushArgs[0]).toBe("push");
    expect(pushArgs).toContain("-u");
    expect(pushArgs).toContain("origin");

    const prArgs = h.spawn.mock.calls[1][1] as string[];
    expect(prArgs[0]).toBe("pr");
    expect(prArgs[1]).toBe("create");
    expect(prArgs).toContain("--title");
    expect(prArgs).toContain("Fix");
    expect(prArgs).toContain("--body");
    expect(prArgs).toContain("Details");
    expect(prArgs).toContain("--base");
    expect(prArgs).toContain("main");
  });

  it("skips the push when push is false", async () => {
    h.spawn.mockImplementation(() => fakeChild(0, "https://github.com/owner/repo/pull/7\n"));
    const res = await post({ directory: "C:\\repo", title: "Fix", push: false });
    expect(res.status).toBe(200);
    expect(h.runGit).not.toHaveBeenCalled();
  });
});
