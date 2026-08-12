import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENCODE_API_GENERATION,
  isOpenCodeApiGeneration,
  isV2ApiGeneration,
  readOpenCodeApiGeneration,
  subscribeOpenCodeApiGeneration,
  writeOpenCodeApiGeneration,
} from "./opencode-generation";

const STORAGE_KEY = "webui:opencode-api-generation";
const EVENT = "webui:opencode-api-generation";

describe("opencode-generation read/write", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to v1 when nothing is stored", () => {
    expect(readOpenCodeApiGeneration()).toBe(DEFAULT_OPENCODE_API_GENERATION);
    expect(readOpenCodeApiGeneration()).toBe("v1");
    expect(isV2ApiGeneration()).toBe(false);
  });

  it("reads the persisted value from localStorage", () => {
    window.localStorage.setItem(STORAGE_KEY, "v2");
    expect(readOpenCodeApiGeneration()).toBe("v2");
    expect(isV2ApiGeneration()).toBe(true);
  });

  it("falls back to the default for an invalid stored value", () => {
    window.localStorage.setItem(STORAGE_KEY, "v3");
    expect(readOpenCodeApiGeneration()).toBe("v1");
    expect(isV2ApiGeneration()).toBe(false);
  });

  it("writes and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOpenCodeApiGeneration(listener);

    writeOpenCodeApiGeneration("v2");

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("v2");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readOpenCodeApiGeneration()).toBe("v2");
    unsubscribe();
  });

  it("unsubscribes cleanly", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOpenCodeApiGeneration(listener);
    unsubscribe();
    writeOpenCodeApiGeneration("v1");
    expect(listener).not.toHaveBeenCalled();
  });

  it("isOpenCodeApiGeneration only accepts v1/v2", () => {
    expect(isOpenCodeApiGeneration("v1")).toBe(true);
    expect(isOpenCodeApiGeneration("v2")).toBe(true);
    expect(isOpenCodeApiGeneration("v3")).toBe(false);
    expect(isOpenCodeApiGeneration(null)).toBe(false);
    expect(isOpenCodeApiGeneration(undefined)).toBe(false);
    expect(isOpenCodeApiGeneration(1)).toBe(false);
  });
});
