import { describe, expect, it } from "vitest";
import { layoutGraph } from "./graph-layout";
import type { GraphCommit } from "./types";

function c(
  hash: string,
  parents: string[],
  subject = hash,
): GraphCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    subject,
    author: "t",
    date: "2026-01-01",
  };
}

describe("layoutGraph", () => {
  it("keeps first-parent chain on lane 0", () => {
    // newest first
    const rows = layoutGraph([
      c("c3", ["c2"]),
      c("c2", ["c1"]),
      c("c1", []),
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
  });

  it("assigns a second lane for a merge parent", () => {
    const rows = layoutGraph([
      c("m", ["a", "b"], "merge"),
      c("a", ["root"]),
      c("b", ["root"]),
      c("root", []),
    ]);
    expect(rows[0].lane).toBe(0);
    expect(rows[0].edges.some((e) => e.kind === "merge")).toBe(true);
    expect(rows[0].commit.parents.length).toBe(2);
  });
});
