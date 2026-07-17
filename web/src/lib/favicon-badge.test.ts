import { describe, expect, it } from "vitest";
import { badgeColor } from "./favicon-badge";

describe("badgeColor", () => {
  it("returns red for attention", () => {
    expect(badgeColor("attention")).toBe("#ef4444");
  });

  it("returns amber for working", () => {
    expect(badgeColor("working")).toBe("#f59e0b");
  });

  it("returns null for idle (no dot)", () => {
    expect(badgeColor("idle")).toBeNull();
  });
});
