import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSetting } = vi.hoisted(() => ({
  getSetting: vi.fn((): string | null => null),
}));

vi.mock("./db", () => ({ getSetting }));

import {
  DEFAULT_OPENCODE_API_GENERATION,
  OPENCODE_API_GENERATION_SETTING_KEY,
} from "./opencode-generation";
import { readServerOpenCodeApiGeneration } from "./opencode-generation-server";

describe("readServerOpenCodeApiGeneration", () => {
  beforeEach(() => {
    getSetting.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to v1 when the settings table has no value", () => {
    getSetting.mockReturnValue(null);
    expect(readServerOpenCodeApiGeneration()).toBe(
      DEFAULT_OPENCODE_API_GENERATION,
    );
    expect(getSetting).toHaveBeenCalledWith(OPENCODE_API_GENERATION_SETTING_KEY);
  });

  it("returns v2 when the settings table stores v2", () => {
    getSetting.mockReturnValue("v2");
    expect(readServerOpenCodeApiGeneration()).toBe("v2");
  });

  it("falls back to the default for an invalid stored value", () => {
    getSetting.mockReturnValue("v3");
    expect(readServerOpenCodeApiGeneration()).toBe("v1");
  });

  it("falls back to the default when the database read throws", () => {
    getSetting.mockImplementation(() => {
      throw new Error("db unavailable");
    });
    expect(readServerOpenCodeApiGeneration()).toBe("v1");
  });
});
