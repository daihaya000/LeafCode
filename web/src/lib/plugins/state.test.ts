import { describe, expect, it } from "vitest";
import { isEnabled, sanitizePrefs } from "./state";

describe("isEnabled", () => {
  it("uses the stored value when present, else the default", () => {
    expect(isEnabled({ a: true }, "a", false)).toBe(true);
    expect(isEnabled({ a: false }, "a", true)).toBe(false);
    expect(isEnabled({}, "a", true)).toBe(true);
    expect(isEnabled({}, "a", false)).toBe(false);
  });

  it("respects an explicit false even when default is true", () => {
    expect(isEnabled({ x: false }, "x", true)).toBe(false);
  });
});

describe("sanitizePrefs", () => {
  it("keeps only boolean entries", () => {
    expect(sanitizePrefs({ a: true, b: false, c: "yes", d: 1, e: null })).toEqual({
      a: true,
      b: false,
    });
  });

  it("returns {} for non-objects and arrays", () => {
    expect(sanitizePrefs(null)).toEqual({});
    expect(sanitizePrefs("x")).toEqual({});
    expect(sanitizePrefs(42)).toEqual({});
    expect(sanitizePrefs([1, 2])).toEqual({});
  });
});
