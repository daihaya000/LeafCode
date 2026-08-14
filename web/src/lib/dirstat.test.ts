import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: 0,
  statusStdout: "",
  diffStdout: "",
}));

// dirStat uses `git status --porcelain --branch` for the branch name and the
// untracked entries, then `git diff HEAD --numstat -M` for tracked changes
// (count + additions/deletions). Count status calls to tell a cache hit from a
// fresh computation.
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
  it("counts tracked files from the diff numstat", async () => {
    h.statusStdout = "## main\nM  src/foo.ts\nA  src/bar.ts\n";
    h.diffStdout = "3\t1\tsrc/foo.ts\n10\t0\tsrc/bar.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.git).toBe(true);
    expect(stat.branch).toBe("main");
    expect(stat.files).toBe(2);
    expect(stat.additions).toBe(13);
    expect(stat.deletions).toBe(1);
  });

  it("adds untracked entries from status to the tracked count", async () => {
    h.statusStdout = "## main\nM  src/foo.ts\n?? src/new.ts\n";
    h.diffStdout = "1\t1\tsrc/foo.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(2);
  });

  it("parses branch with upstream tracking info", async () => {
    h.statusStdout = "## main...origin/main [ahead 2]\nM  src/foo.ts\n";
    h.diffStdout = "1\t1\tsrc/foo.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.branch).toBe("main");
    expect(stat.files).toBe(1);
  });

  it("returns null branch for detached HEAD", async () => {
    h.statusStdout = "## HEAD (no branch)\nM  src/foo.ts\n";
    h.diffStdout = "1\t1\tsrc/foo.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.branch).toBeNull();
    expect(stat.files).toBe(1);
  });

  it("counts binary files without counting their '-' line stats", async () => {
    h.statusStdout = "## main\nM  assets/logo.png\n";
    h.diffStdout = "-\t-\tassets/logo.png\n";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
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

describe("dirStat phantom modifications", () => {
  it("ignores a status-only modification that produces no diff", async () => {
    // Regression: on Windows with core.autocrlf=true, `git status` reports a
    // CRLF working copy of an LF blob as modified (the on-disk size differs
    // from the size cached in the index by one byte per line) even though the
    // diff is empty. Counting those made the badge say 変更あり while the Diff
    // tab showed nothing.
    h.statusStdout = "## main\n M web/src/components/task/GraphPanel.tsx\n";
    h.diffStdout = "";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(0);
    expect(stat.additions).toBe(0);
    expect(stat.deletions).toBe(0);
  });

  it("still counts real changes alongside a phantom entry", async () => {
    h.statusStdout = "## main\n M src/phantom.ts\n M src/real.ts\n";
    h.diffStdout = "2\t2\tsrc/real.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
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
  it("excludes an untracked metadata path from the file count", async () => {
    h.statusStdout = "## main\n?? .leafcode/state.json\n?? src/new.ts\n";
    h.diffStdout = "";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
  });

  it("excludes pre-rebrand metadata names from the file count", async () => {
    h.statusStdout = "## main\n?? .opencode-webui/state.json\n?? src/new.ts\n";
    h.diffStdout = "";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
  });

  it("excludes a rename into the metadata dir from the file count", async () => {
    // Regression: a numstat rename entry is "add<TAB>del<TAB>orig => new" (or
    // the brace-compressed form) — checking the whole field against
    // ".leafcode/..." never matches, so renames into/out of it leak into
    // the visible count.
    h.statusStdout = "## main\n";
    h.diffStdout =
      "0\t0\tsrc/foo.ts => .leafcode/foo.ts\n1\t1\tsrc/bar.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
  });

  it("excludes a rename out of the metadata dir from the file count", async () => {
    h.statusStdout = "## main\n";
    h.diffStdout =
      "0\t0\t.leafcode/foo.ts => src/foo.ts\n1\t1\tsrc/bar.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
  });

  it("excludes a brace-compressed rename into the metadata dir", async () => {
    h.statusStdout = "## main\n";
    h.diffStdout = "0\t0\t{src => .leafcode}/foo.ts\n1\t1\tsrc/bar.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
  });

  it("counts a plain rename once, using the new path", async () => {
    h.statusStdout = "## main\n";
    h.diffStdout = "0\t0\tsrc/{old => new}/foo.ts\n";
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
  });
});
