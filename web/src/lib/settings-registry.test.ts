import { describe, expect, it } from "vitest";
import {
  ALLOWED_KEYS,
  normalizeSettingValue,
} from "./settings-registry";

describe("notification sound settings registry", () => {
  it("allows and validates the notification sound keys", () => {
    expect(ALLOWED_KEYS.has("notification-sound-type")).toBe(true);
    expect(ALLOWED_KEYS.has("notification-sound-volume")).toBe(true);

    expect(normalizeSettingValue("notification-sound-type", "standard")).toEqual({
      ok: true,
      value: "standard",
    });
    expect(normalizeSettingValue("notification-sound-type", "soft")).toEqual({
      ok: true,
      value: "soft",
    });
    expect(normalizeSettingValue("notification-sound-type", "loud").ok).toBe(false);

    expect(normalizeSettingValue("notification-sound-volume", "0")).toEqual({
      ok: true,
      value: "0",
    });
    expect(normalizeSettingValue("notification-sound-volume", "100")).toEqual({
      ok: true,
      value: "100",
    });
    expect(normalizeSettingValue("notification-sound-volume", "101").ok).toBe(false);
    expect(normalizeSettingValue("notification-sound-volume", "50.5").ok).toBe(false);
  });
});
