import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: 0 }));

// Each dirStat() invocation runs several git commands; count HEAD lookups to
// tell a cache hit (0 new git calls) from a fresh computation.
vi.mock("./git", () => ({
  runGit: vi.fn(async (_dir: string, args: string[]) => {
    if (args[0] === "rev-parse") {
      h.calls++;
      return { code: 0, stdout: "main\n", stderr: "" };
    }
    if (args[0] === "diff") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  }),
}));

import { dirStat, invalidateDirStat } from "./dirstat";

const DIR = "/tmp/repo";

beforeEach(() => {
  h.calls = 0;
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
