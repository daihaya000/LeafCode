import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_MODELS_CACHE_MAX_AGE_MS,
  clearProviderModelsCache,
  readProviderModelsCache,
  writeProviderModelsCache,
} from "./provider-models-cache";
import type { ProviderModelsDto } from "./extensions";

const STORAGE_KEY = "webui:provider-models-cache";

const providers: ProviderModelsDto[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    enabled: true,
    models: [
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        enabled: true,
        variants: { low: {}, high: {} },
      },
    ],
  },
];

describe("provider-models-cache", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00Z"));
  });
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns null when nothing is stored", () => {
    expect(readProviderModelsCache()).toBeNull();
  });

  it("round-trips a stored catalogue", () => {
    writeProviderModelsCache(providers);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(readProviderModelsCache()).toEqual(providers);
  });

  it("does not write an empty catalogue", () => {
    writeProviderModelsCache([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readProviderModelsCache()).toBeNull();
  });

  it("rejects a malformed payload", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), providers: "nope" }));
    expect(readProviderModelsCache()).toBeNull();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), providers: [{ id: 1 }] }));
    expect(readProviderModelsCache()).toBeNull();
  });

  it("rejects an entry without a valid timestamp", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ providers }));
    expect(readProviderModelsCache()).toBeNull();
  });

  it("rejects an expired entry", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        at: Date.now() - PROVIDER_MODELS_CACHE_MAX_AGE_MS - 1,
        providers,
      }),
    );
    expect(readProviderModelsCache()).toBeNull();
  });

  it("accepts an entry at the edge of the stale window", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        at: Date.now() - PROVIDER_MODELS_CACHE_MAX_AGE_MS,
        providers,
      }),
    );
    expect(readProviderModelsCache()).toEqual(providers);
  });

  it("returns null when the stored JSON is corrupt", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readProviderModelsCache()).toBeNull();
  });

  it("clear drops the stored entry", () => {
    writeProviderModelsCache(providers);
    clearProviderModelsCache();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readProviderModelsCache()).toBeNull();
  });

  it("tolerates storage quota failures on write", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    expect(() => writeProviderModelsCache(providers)).not.toThrow();
    expect(readProviderModelsCache()).toBeNull();
    setItem.mockRestore();
  });
});
