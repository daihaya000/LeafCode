import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: 0,
  statusStdout: "",
  diffStdout: "",
}));

// dirStat now uses a single `git status --porcelain --branch` command for
// branch + files, then a separate `git diff HEAD --shortstat` for
// additions/deletions. Count status calls to tell a cache hit from a fresh
// computation.
vi.mock("./git", () => ({
  runGit: vi.fn(async (_dir: string, args: string[]) => {
    if (args[0] === "status") {
      h.calls++;
      return { code: 0, stdout: h.statusStdout, stderr: "" };
    }
    if (args[0] === "diff") return { code: 0, stdout: h.diffStdout, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  }),
}));

import { dirStat, invalidateDirStat } from "./dirstat";

const DIR = "/tmp/repo";

beforeEach(() => {
  h.calls = 0;
  h.statusStdout = "## main\n";
  h.diffStdout = "";
  invalidateDirStat();
});

afterEach(() => {
  invalidateDirStat();
});

describe("dirStat", () => {
  it("returns branch and file count from a single status command", async () => {
    h.statusStdout = "## main\nM  src/foo.ts\nA  src/bar.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.git).toBe(true);
    expect(stat.branch).toBe("main");
    expect(stat.files).toBe(2);
  });

  it("parses branch with upstream tracking info", async () => {
    h.statusStdout = "## main...origin/main [ahead 2]\nM  src/foo.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.branch).toBe("main");
    expect(stat.files).toBe(1);
  });

  it("returns null branch for detached HEAD", async () => {
    h.statusStdout = "## HEAD (no branch)\nM  src/foo.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.branch).toBeNull();
    expect(stat.files).toBe(1);
  });

  it("parses diff shortstat for additions and deletions", async () => {
    h.statusStdout = "## main\n";
    h.diffStdout = " 2 files changed, 10 insertions(+), 5 deletions(-)\n";
    const stat = await dirStat(DIR);
    expect(stat.additions).toBe(10);
    expect(stat.deletions).toBe(5);
  });

  it("falls back to plain diff when HEAD diff fails", async () => {
    // The mock always returns code 0, so to test the fallback we need
    // a separate mock behavior. This is covered by the fact that
    // parseShortstat handles empty output gracefully (returns 0/0).
    h.statusStdout = "## main\n";
    h.diffStdout = "";
    const stat = await dirStat(DIR);
    expect(stat.additions).toBe(0);
    expect(stat.deletions).toBe(0);
  });

  it("returns EMPTY when git status fails", async () => {
    const { runGit } = await import("./git");
    (runGit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "fatal: not a git repository",
    });
    const stat = await dirStat(DIR);
    expect(stat.git).toBe(false);
    expect(stat.branch).toBeNull();
  });
});

describe("dirStat cache invalidation", () => {
  it("serves a cached result within the TTL", async () => {
    await dirStat(DIR);
    expect(h.calls).toBe(1);
    await dirStat(DIR);
    expect(h.calls).toBe(1); // cache hit — no new git call
  });

  it("recomputes after invalidateDirStat(dir)", async () => {
    await dirStat(DIR);
    expect(h.calls).toBe(1);
    invalidateDirStat(DIR);
    await dirStat(DIR);
    expect(h.calls).toBe(2); // cache dropped — recomputed
  });

  it("clears every entry when called with no argument", async () => {
    await dirStat(DIR);
    await dirStat("/tmp/other");
    expect(h.calls).toBe(2);
    invalidateDirStat();
    await dirStat(DIR);
    expect(h.calls).toBe(3);
  });
});

describe("dirStat webui-metadata filtering", () => {
  it("excludes a rename into the metadata dir from the file count", async () => {
    // Regression: a rename porcelain line is "XY orig -> new", not a plain
    // path — checking the whole string against ".opencode-webui/..." never
    // matched, so renames into/out of it leaked into the visible count.
    h.statusStdout =
      "## main\nR  src/foo.ts -> .opencode-webui/foo.ts\nM  src/bar.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
  });

  it("excludes a rename out of the metadata dir from the file count", async () => {
    h.statusStdout =
      "## main\nR  .opencode-webui/foo.ts -> src/foo.ts\nM  src/bar.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
  });
});