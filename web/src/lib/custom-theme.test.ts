import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOM_THEME_STORAGE_KEY,
  clearCustomThemeTokens,
  readCustomThemeTokens,
  resolveCustomThemeTokens,
  writeCustomThemeTokens,
} from "./custom-theme";

const getItem = vi.spyOn(Storage.prototype, "getItem");
const removeItem = vi.spyOn(Storage.prototype, "removeItem");

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("custom theme tokens", () => {
  it("returns null when nothing is saved", () => {
    expect(readCustomThemeTokens()).toBeNull();
  });

  it("round-trips saved tokens", () => {
    writeCustomThemeTokens({ "--bg": "#112233", "--text": "#FFFFFF" });
    expect(readCustomThemeTokens()).toEqual({
      "--bg": "#112233",
      "--text": "#ffffff",
    });
  });

  it("drops malformed keys and non-hex values on write and read", () => {
    writeCustomThemeTokens({
      "--bg": "#112233",
      "--bad/input": "#000000",
      "--text": "red",
    });
    expect(readCustomThemeTokens()).toEqual({ "--bg": "#112233" });
  });

  it("ignores corrupt storage content", () => {
    getItem.mockReturnValueOnce("not json");
    expect(readCustomThemeTokens()).toBeNull();
    getItem.mockReturnValueOnce("[]");
    expect(readCustomThemeTokens()).toBeNull();
    getItem.mockReturnValueOnce(JSON.stringify({ "--bg": "nope" }));
    expect(readCustomThemeTokens()).toBeNull();
  });

  it("falls back to defaults for parts the user did not save", () => {
    localStorage.setItem(
      CUSTOM_THEME_STORAGE_KEY,
      JSON.stringify({ "--bg": "#112233" }),
    );
    const resolved = resolveCustomThemeTokens();
    expect(resolved["--bg"]).toBe("#112233");
    expect(resolved["--text"]).toBe("#1e1b16");
  });

  it("clears saved tokens", () => {
    writeCustomThemeTokens({ "--bg": "#112233" });
    clearCustomThemeTokens();
    expect(removeItem).toHaveBeenCalledWith(CUSTOM_THEME_STORAGE_KEY);
    expect(readCustomThemeTokens()).toBeNull();
  });
});
