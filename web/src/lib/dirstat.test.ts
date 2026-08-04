import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: 0, statusStdout: "" }));

// Each dirStat() invocation runs several git commands; count HEAD lookups to
// tell a cache hit (0 new git calls) from a fresh computation.
vi.mock("./git", () => ({
  runGit: vi.fn(async (_dir: string, args: string[]) => {
    if (args[0] === "rev-parse") {
      h.calls++;
      return { code: 0, stdout: "main\n", stderr: "" };
    }
    if (args[0] === "diff") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "status") return { code: 0, stdout: h.statusStdout, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  }),
}));

import { dirStat, invalidateDirStat } from "./dirstat";

const DIR = "/tmp/repo";

beforeEach(() => {
  h.calls = 0;
  h.statusStdout = "";
  invalidateDirStat();
});

afterEach(() => {
  invalidateDirStat();
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
    h.statusStdout = 'R  src/foo.ts -> .opencode-webui/foo.ts\nM  src/bar.ts\n';
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
  });

  it("excludes a rename out of the metadata dir from the file count", async () => {
    h.statusStdout = 'R  .opencode-webui/foo.ts -> src/foo.ts\nM  src/bar.ts\n';
    const stat = await dirStat(DIR);
    expect(stat.files).toBe(1);
  });
});
