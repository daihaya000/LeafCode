import { afterEach, describe, expect, it } from "vitest";
import { isEnabled, readAddonPrefs, sanitizePrefs, writeAddonEnabled } from "./state";

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

describe("writeAddonEnabled", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("does not lose an update when two calls race (regression: unsynchronized read-modify-write)", async () => {
    // Two near-simultaneous toggles used to both read the same pre-update
    // prefs, and the second `setItem` silently dropped the first call's
    // change since neither awaited the other.
    writeAddonEnabled("addon-a", true);
    writeAddonEnabled("addon-b", true);
    // writeAddonEnabled queues its work on a microtask; flush the queue.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(readAddonPrefs()).toEqual({ "addon-a": true, "addon-b": true });
  });
});
