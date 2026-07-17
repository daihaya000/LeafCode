import { describe, expect, it } from "vitest";
import { assertSafeBranchName } from "./git";

describe("assertSafeBranchName", () => {
  it("accepts ordinary local and remote branch names", () => {
    expect(() => assertSafeBranchName("main")).not.toThrow();
    expect(() => assertSafeBranchName("origin/release-1.2")).not.toThrow();
  });

  it("rejects option-like and traversal-like names", () => {
    expect(() => assertSafeBranchName("--force")).toThrow("invalid branch name");
    expect(() => assertSafeBranchName("feature/../main")).toThrow(
      "invalid branch name",
    );
  });
});
