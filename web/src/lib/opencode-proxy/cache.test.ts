import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearGetResponseCacheForTest,
  readBoundedCapabilityCache,
  setBoundedCapabilityCache,
} from "./cache";

afterEach(() => {
  __clearGetResponseCacheForTest();
  vi.restoreAllMocks();
});

describe("capability cache TTL", () => {
  it("returns a fresh entry and drops it after the TTL", () => {
    vi.useFakeTimers();
    try {
      const cache = new Map<string, { at: number; value: string }>();
      setBoundedCapabilityCache(cache, "dir1", "v1");
      expect(readBoundedCapabilityCache(cache, "dir1")).toBe("v1");

      vi.advanceTimersByTime(60_000);
      expect(readBoundedCapabilityCache(cache, "dir1")).toBeUndefined();
      expect(cache.has("dir1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns undefined for a missing key", () => {
    const cache = new Map<string, { at: number; value: string }>();
    expect(readBoundedCapabilityCache(cache, "nope")).toBeUndefined();
  });
});
