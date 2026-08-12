import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENCODE_API_GENERATION,
  isOpenCodeApiGeneration,
  isV2ApiGeneration,
  readOpenCodeApiGeneration,
  registerServerOpenCodeApiGenerationResolver,
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

describe("server generation resolver", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    registerServerOpenCodeApiGenerationResolver(() => DEFAULT_OPENCODE_API_GENERATION);
  });

  it("follows the registered server resolver when window is absent", () => {
    const originalWindow = globalThis.window;
    // Simulate the server: no `window` global. jsdom defines it as a getter,
    // so temporarily shadow it.
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get: () => undefined,
    });
    try {
      const resolver = vi.fn(() => "v2" as const);
      registerServerOpenCodeApiGenerationResolver(resolver);
      expect(readOpenCodeApiGeneration()).toBe("v2");
      expect(isV2ApiGeneration()).toBe(true);
      expect(resolver).toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        get: () => originalWindow,
      });
    }
  });

  it("falls back to the default without a registered resolver", () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get: () => undefined,
    });
    try {
      registerServerOpenCodeApiGenerationResolver(() => "v1" as const);
      expect(readOpenCodeApiGeneration()).toBe("v1");
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        get: () => originalWindow,
      });
    }
  });
});
