import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampHangTimeoutMs,
  DEFAULT_HANG_TIMEOUT_MS,
  formatHangTimeout,
  MAX_HANG_TIMEOUT_MS,
  MIN_HANG_TIMEOUT_MS,
  readHangTimeoutMs,
  writeHangTimeoutMs,
} from "./hang-timeout";

describe("hang-timeout", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("uses the default and clamps configured values", () => {
    expect(readHangTimeoutMs()).toBe(DEFAULT_HANG_TIMEOUT_MS);
    writeHangTimeoutMs(1);
    expect(readHangTimeoutMs()).toBe(MIN_HANG_TIMEOUT_MS);
    writeHangTimeoutMs(MAX_HANG_TIMEOUT_MS + 1);
    expect(readHangTimeoutMs()).toBe(MAX_HANG_TIMEOUT_MS);
  });

  it("normalizes invalid values to the default", () => {
    localStorage.setItem("webui:hang-timeout", "not-a-number");
    expect(readHangTimeoutMs()).toBe(DEFAULT_HANG_TIMEOUT_MS);
    expect(clampHangTimeoutMs(Number.NaN)).toBe(DEFAULT_HANG_TIMEOUT_MS);
  });

  it("formats the threshold for notices", () => {
    expect(formatHangTimeout(5 * 60_000)).toBe("5分");
    expect(formatHangTimeout(90_000)).toBe("1.5分");
    expect(formatHangTimeout(MIN_HANG_TIMEOUT_MS)).toBe("10秒");
    expect(formatHangTimeout(Number.NaN)).toBe("5分");
  });
});
