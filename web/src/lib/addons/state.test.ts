import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADDONS_CHANGED_EVENT,
  isEnabled,
  readAddonPrefs,
  sanitizePrefs,
  writeAddonEnabled,
} from "./state";

describe("addons/state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("isEnabled", () => {
    it("uses the stored pref when present", () => {
      expect(isEnabled({ "addon-a": false }, "addon-a", true)).toBe(false);
      expect(isEnabled({ "addon-a": true }, "addon-a", false)).toBe(true);
    });

    it("falls back to the default", () => {
      expect(isEnabled({}, "addon-a", true)).toBe(true);
      expect(isEnabled({}, "addon-a", false)).toBe(false);
    });
  });

  describe("sanitizePrefs", () => {
    it("keeps only boolean entries", () => {
      expect(
        sanitizePrefs({ a: true, b: false, c: "yes", d: 1, e: null }),
      ).toEqual({ a: true, b: false });
    });

    it("returns an empty object for invalid input", () => {
      expect(sanitizePrefs(null)).toEqual({});
      expect(sanitizePrefs("x")).toEqual({});
      expect(sanitizePrefs([])).toEqual({});
    });
  });

  describe("readAddonPrefs", () => {
    it("reads the current storage key", () => {
      localStorage.setItem("webui:addons", JSON.stringify({ a: true }));
      expect(readAddonPrefs()).toEqual({ a: true });
    });

    it("migrates legacy webui:plugins once and removes the legacy key", () => {
      localStorage.setItem(
        "webui:plugins",
        JSON.stringify({ old: true, junk: "x" }),
      );
      expect(readAddonPrefs()).toEqual({ old: true });
      expect(localStorage.getItem("webui:addons")).toBe(
        JSON.stringify({ old: true }),
      );
      expect(localStorage.getItem("webui:plugins")).toBeNull();
    });

    it("returns an empty object when nothing is stored", () => {
      expect(readAddonPrefs()).toEqual({});
    });
  });

  describe("writeAddonEnabled", () => {
    it("writes the pref and dispatches the change event", async () => {
      const listener = vi.fn();
      window.addEventListener(ADDONS_CHANGED_EVENT, listener);
      writeAddonEnabled("addon-a", true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      window.removeEventListener(ADDONS_CHANGED_EVENT, listener);

      expect(localStorage.getItem("webui:addons")).toBe(
        JSON.stringify({ "addon-a": true }),
      );
      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({ "addon-a": true });
    });
  });
});
