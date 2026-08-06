import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let workspace = "";

vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn(() => ({ ok: true, path: workspace })),
}));

const { runGit } = vi.hoisted(() => ({
  runGit: vi.fn(),
}));

vi.mock("@/lib/git", () => ({ runGit }));

import { GET } from "./route";

describe("GET /api/diff/files untracked safety", () => {
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "diff-files-"));
    runGit.mockReset();
    runGit.mockImplementation(async (_cwd: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
        return { code: 0, stdout: "main\n", stderr: "" };
      }
      if (args[0] === "diff") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "status") {
        return {
          code: 0,
          stdout: "?? safe.txt\n?? leak\n",
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("reads a normal untracked file into a hunk", async () => {
    fs.writeFileSync(path.join(workspace, "safe.txt"), "hello\n");
    fs.writeFileSync(path.join(workspace, "leak"), "should-not-matter\n");

    const res = await GET(
      new NextRequest(
        `http://localhost/api/diff/files?directory=${encodeURIComponent(workspace)}`,
        { headers: { host: "127.0.0.1:3000" } },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      files: { path: string; hunks: { lines: { t: string; text: string }[] }[] }[];
    };
    const safe = body.files.find((f) => f.path === "safe.txt");
    expect(safe?.hunks[0]?.lines.some((l) => l.text.includes("hello"))).toBe(
      true,
    );
  });

  it("does not follow an untracked symlink outside the workspace", async () => {
    const outside = path.join(path.dirname(workspace), "secret-outside.txt");
    fs.writeFileSync(outside, "TOP_SECRET\n");
    const link = path.join(workspace, "leak");
    try {
      fs.symlinkSync(outside, link, "file");
    } catch {
      // Symlinks may be unavailable without privileges on Windows.
      return;
    }

    const res = await GET(
      new NextRequest(
        `http://localhost/api/diff/files?directory=${encodeURIComponent(workspace)}`,
        { headers: { host: "127.0.0.1:3000" } },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      files: { path: string; hunks: unknown[]; additions: number }[];
    };
    const leak = body.files.find((f) => f.path === "leak");
    expect(leak).toBeTruthy();
    expect(leak?.hunks ?? []).toEqual([]);
    expect(leak?.additions ?? 0).toBe(0);
    expect(JSON.stringify(body)).not.toContain("TOP_SECRET");
  });
});
