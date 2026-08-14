import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOM_THEME_STORAGE_KEY } from "@/lib/custom-theme";
import { ThemeTokenSync } from "./ThemeTokenSync";

const themeState = { resolvedTheme: "oyster" };

vi.mock("next-themes", () => ({
  useTheme: () => themeState,
}));

describe("ThemeTokenSync", () => {
  const setProperty = vi.fn();
  const removeProperty = vi.fn();

  beforeEach(() => {
    setProperty.mockClear();
    removeProperty.mockClear();
    vi.spyOn(document.documentElement.style, "setProperty").mockImplementation(
      setProperty,
    );
    vi.spyOn(document.documentElement.style, "removeProperty").mockImplementation(
      removeProperty,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("applies oyster tokens when the resolved theme is oyster", async () => {
    themeState.resolvedTheme = "oyster";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "oyster",
            tokens: {
              "--bg": "#112233",
              "--text": "#ffffff",
              "--bad/input": "#000000",
              "--num": 3,
            },
          }),
      }),
    );

    render(<ThemeTokenSync />);

    await waitFor(() => expect(setProperty).toHaveBeenCalled());

    expect(setProperty).toHaveBeenCalledWith("--bg", "#112233");
    expect(setProperty).toHaveBeenCalledWith("--text", "#ffffff");
    // Malformed keys and non-string values are skipped.
    expect(setProperty).not.toHaveBeenCalledWith("--bad/input", "#000000");
    expect(setProperty).not.toHaveBeenCalledWith("--num", 3);
  });

  it("removes applied tokens when the theme is not oyster", async () => {
    themeState.resolvedTheme = "light";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "oyster",
            tokens: { "--bg": "#112233" },
          }),
      }),
    );

    const { rerender } = render(<ThemeTokenSync />);

    themeState.resolvedTheme = "oyster";
    rerender(<ThemeTokenSync />);
    await waitFor(() => expect(setProperty).toHaveBeenCalledWith("--bg", "#112233"));

    themeState.resolvedTheme = "dark";
    rerender(<ThemeTokenSync />);

    await waitFor(() =>
      expect(removeProperty).toHaveBeenCalledWith("--bg"),
    );
  });

  it("does nothing when the fetch fails", async () => {
    themeState.resolvedTheme = "oyster";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await act(async () => {
      render(<ThemeTokenSync />);
    });

    expect(setProperty).not.toHaveBeenCalled();
  });

  it("applies saved custom tokens when the theme is custom", async () => {
    themeState.resolvedTheme = "custom";
    localStorage.setItem(
      CUSTOM_THEME_STORAGE_KEY,
      JSON.stringify({ "--bg": "#112233", "--text": "#eeeeee" }),
    );

    render(<ThemeTokenSync />);

    await waitFor(() => expect(setProperty).toHaveBeenCalledWith("--bg", "#112233"));
    expect(setProperty).toHaveBeenCalledWith("--text", "#eeeeee");
    // Defaults fill parts the user did not save.
    expect(setProperty).toHaveBeenCalledWith("--surface", "#fbf8f2");
  });

  it("re-applies custom tokens on the change event", async () => {
    themeState.resolvedTheme = "custom";
    localStorage.setItem(
      CUSTOM_THEME_STORAGE_KEY,
      JSON.stringify({ "--bg": "#112233" }),
    );

    render(<ThemeTokenSync />);
    await waitFor(() => expect(setProperty).toHaveBeenCalledWith("--bg", "#112233"));

    setProperty.mockClear();
    localStorage.setItem(
      CUSTOM_THEME_STORAGE_KEY,
      JSON.stringify({ "--bg": "#445566" }),
    );
    fireEvent(window, new CustomEvent("webui:custom-theme-changed"));

    await waitFor(() =>
      expect(setProperty).toHaveBeenCalledWith("--bg", "#445566"),
    );
  });
});
