import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  runGit: vi.fn<(...args: unknown[]) => Promise<{ code: number; stdout: string; stderr: string }>>(
    async () => ({ code: 0, stdout: "", stderr: "" }),
  ),
  assertAllowedDirectory: vi.fn<(...args: unknown[]) => { ok: true; path: string }>(() => ({
    ok: true,
    path: "C:\\repo",
  })),
  invalidateDirStat: vi.fn<(...args: unknown[]) => void>(() => undefined),
  getSetting: vi.fn<(key: string) => string | null>(() => null),
}));

vi.mock("@/lib/db", () => ({ getSetting: (key: string) => h.getSetting(key) }));

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
  h.getSetting.mockReturnValue(null);
});

function lastGitEnv() {
  const call = h.runGit.mock.calls.find((c) => (c[1] as string[])[0] === "commit");
  return (call?.[3] as Record<string, string> | undefined) ?? {};
}

describe("commit author stamping", () => {
  it("defaults to the build agent when no agent is supplied", async () => {
    await post({ directory: "C:\\repo", message: "fix", paths: ["src/a.ts"] });
    expect(lastGitEnv()).toMatchObject({
      GIT_AUTHOR_NAME: "build",
      GIT_AUTHOR_EMAIL: "build@opencode.local",
      GIT_COMMITTER_NAME: "build",
      GIT_COMMITTER_EMAIL: "build@opencode.local",
    });
  });

  it("stamps the supplied agent name", async () => {
    await post({
      directory: "C:\\repo",
      message: "fix",
      paths: ["src/a.ts"],
      agent: "lead-programmer",
    });
    expect(lastGitEnv()).toMatchObject({
      GIT_AUTHOR_NAME: "lead-programmer",
      GIT_AUTHOR_EMAIL: "lead-programmer@opencode.local",
    });
  });

  it("uses the configured real-user identity when set", async () => {
    h.getSetting.mockImplementation((key) =>
      key === "commit-author-name"
        ? "Daichi"
        : key === "commit-author-email"
          ? "daichi@estprime.com"
          : null,
    );
    await post({ directory: "C:\\repo", message: "fix", paths: ["src/a.ts"] });
    expect(lastGitEnv()).toMatchObject({
      GIT_AUTHOR_NAME: "Daichi",
      GIT_AUTHOR_EMAIL: "daichi@estprime.com",
      GIT_COMMITTER_NAME: "Daichi",
      GIT_COMMITTER_EMAIL: "daichi@estprime.com",
    });
  });

  it("keeps the agent-derived email when only the name is configured", async () => {
    h.getSetting.mockImplementation((key) =>
      key === "commit-author-name" ? "Daichi" : null,
    );
    await post({ directory: "C:\\repo", message: "fix", paths: ["src/a.ts"] });
    expect(lastGitEnv()).toMatchObject({
      GIT_AUTHOR_NAME: "Daichi",
      GIT_AUTHOR_EMAIL: "build@opencode.local",
    });
  });

  it("ignores a stored identity that Git could not store safely", async () => {
    h.getSetting.mockImplementation((key) =>
      key === "commit-author-name" ? "Evil <x>" : null,
    );
    await post({ directory: "C:\\repo", message: "fix", paths: ["src/a.ts"] });
    expect(lastGitEnv()).toMatchObject({ GIT_AUTHOR_NAME: "build" });
  });

  it("falls back to build for an invalid agent name", async () => {
    await post({
      directory: "C:\\repo",
      message: "fix",
      paths: ["src/a.ts"],
      agent: "not valid!",
    });
    expect(lastGitEnv()).toEqual({});
  });
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
    expect(h.runGit).toHaveBeenCalledWith("C:\\repo", ["add", "--", "src/a.ts"]);
  });
});
