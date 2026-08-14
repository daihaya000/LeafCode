import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  runGit: vi.fn<
    (cwd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>
  >(async () => ({ code: 0, stdout: "", stderr: "" })),
  assertAllowedDirectory: vi.fn<(...args: unknown[]) => { ok: true; path: string }>(() => ({
    ok: true,
    path: "",
  })),
  invalidateDirStat: vi.fn<(...args: unknown[]) => void>(() => undefined),
}));

vi.mock("@/lib/git", () => ({
  runGit: (cwd: string, args: string[]) => h.runGit(cwd, args),
}));
vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: (...a: unknown[]) => h.assertAllowedDirectory(...a),
}));
vi.mock("@/lib/dirstat", () => ({
  invalidateDirStat: (...a: unknown[]) => h.invalidateDirStat(...a),
}));

import { POST } from "./route";

let tmpDir: string;

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/git/rm", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-webui-rm-"));
  h.assertAllowedDirectory.mockReturnValue({ ok: true, path: tmpDir });
  h.runGit.mockResolvedValue({ code: 1, stdout: "", stderr: "did not match any files" });
});

describe("POST /api/git/rm", () => {
  it("returns 400 for paths that would touch WebUI metadata", async () => {
    const res = await post({
      directory: tmpDir,
      path: ".leafcode/sessions.json",
    });
    expect(res.status).toBe(400);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("returns 404 when the file does not exist", async () => {
    const res = await post({ directory: tmpDir, path: "src/missing.ts" });
    expect(res.status).toBe(404);
    expect(h.runGit).not.toHaveBeenCalled();
  });

  it("runs git rm -f for a tracked file and invalidates the dir stat", async () => {
    h.runGit.mockImplementation(async (cwd: string, args: string[]) =>
      (args[0] === "ls-files" && args[1] === "--error-unmatch")
        ? { code: 0, stdout: "", stderr: "" }
        : { code: 0, stdout: "", stderr: "" },
    );
    const file = path.join(tmpDir, "src", "file.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x");

    const res = await post({ directory: tmpDir, path: "src/file.ts" });
    expect(res.status).toBe(200);
    expect(h.runGit).toHaveBeenCalledWith(tmpDir, ["rm", "-f", "--", "src/file.ts"]);
    expect(h.invalidateDirStat).toHaveBeenCalledWith(tmpDir);
  });

  it("unlinks an untracked file directly", async () => {
    const file = path.join(tmpDir, "src", "new.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x");

    const res = await post({ directory: tmpDir, path: "src/new.ts" });
    expect(res.status).toBe(200);
    expect(fs.existsSync(file)).toBe(false);
    expect(h.invalidateDirStat).toHaveBeenCalledWith(tmpDir);
  });

  it("returns 500 when git rm fails", async () => {
    h.runGit.mockImplementation(async (cwd: string, args: string[]) => {
      if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
      return { code: 1, stdout: "", stderr: "permission denied" };
    });
    const file = path.join(tmpDir, "file.ts");
    fs.writeFileSync(file, "x");

    const res = await post({ directory: tmpDir, path: "file.ts" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "permission denied" });
  });

  it("rejects an absolute path", async () => {
    const res = await post({ directory: tmpDir, path: "C:\\Windows\\System32\\x.ts" });
    expect(res.status).toBe(400);
  });
});
