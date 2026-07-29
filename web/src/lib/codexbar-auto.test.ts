import { beforeEach, describe, expect, it, vi } from "vitest";

const { getJson, readAddonPrefs } = vi.hoisted(() => ({
  getJson: vi.fn(),
  readAddonPrefs: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ getJson }));
vi.mock("@/lib/addons/state", () => ({
  isEnabled: (prefs: Record<string, boolean>, id: string, fallback: boolean) =>
    Object.hasOwn(prefs, id) ? prefs[id] : fallback,
  readAddonPrefs,
}));

import { readCodexBarAutoUsage } from "./codexbar-auto";

describe("readCodexBarAutoUsage", () => {
  beforeEach(() => {
    getJson.mockReset();
    readAddonPrefs.mockReset();
    readAddonPrefs.mockReturnValue({});
  });

  it("does not request usage while CodexBar is disabled", async () => {
    readAddonPrefs.mockReturnValue({ "codexbar-usage": false });
    await expect(readCodexBarAutoUsage()).resolves.toBeUndefined();
    expect(getJson).not.toHaveBeenCalled();
  });

  it("maps usable OpenCode provider usage", async () => {
    getJson.mockResolvedValue({
      available: true,
      providers: [
        { opencodeId: "openai", usedPercent: 80, limited: false, maxed: false },
        { opencodeId: "anthropic", usedPercent: 99, limited: false, maxed: true },
        { opencodeId: null, usedPercent: 5, limited: false, maxed: false },
      ],
    });
    await expect(readCodexBarAutoUsage()).resolves.toEqual({
      openai: { usedPercent: 80, limited: false },
      anthropic: { usedPercent: 99, limited: true },
    });
  });

  it("falls back to normal Auto routing when the snapshot is unavailable", async () => {
    getJson.mockResolvedValue({ available: false, providers: [] });
    await expect(readCodexBarAutoUsage()).resolves.toBeUndefined();
  });
});
