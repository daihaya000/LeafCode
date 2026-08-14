import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOM_THEME_STORAGE_KEY } from "@/lib/custom-theme";

const themeState = {
  theme: "light",
  resolvedTheme: "light",
  setTheme: vi.fn(),
};

vi.mock("next-themes", () => ({
  useTheme: () => themeState,
}));

import { ThemeSettings } from "./GeneralSettingsTab";

async function selectTheme(
  rerender: (ui: React.ReactElement) => void,
  ui: React.ReactElement,
  key: string,
) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /カスタム/ }));
    themeState.theme = key;
    themeState.resolvedTheme = key;
    rerender(ui);
  });
}

describe("ThemeSettings", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    themeState.theme = "light";
    themeState.resolvedTheme = "light";
    themeState.setTheme.mockClear();
    localStorage.clear();
  });

  it("shows all theme options including custom", async () => {
    render(<ThemeSettings />);
    await waitFor(() => expect(screen.getByText("表示テーマ")).toBeDefined());
    expect(screen.getByRole("button", { name: /カスタム/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /オフホワイト/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /システム/ })).toBeDefined();
  });

  it("reveals the color editor when custom is selected", async () => {
    const { rerender } = render(<ThemeSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: /カスタム/ })).toBeDefined());
    await selectTheme(rerender, <ThemeSettings />, "custom");

    expect(themeState.setTheme).toHaveBeenCalledWith("custom");
    await waitFor(() =>
      expect(screen.getByText("カスタムテーマの色")).toBeDefined(),
    );
    expect(screen.getByLabelText("背景の色")).toBeDefined();
    expect(screen.getByLabelText("アクセントの色")).toBeDefined();
  });

  it("saves a color change to localStorage", async () => {
    const { rerender } = render(<ThemeSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: /カスタム/ })).toBeDefined());
    await selectTheme(rerender, <ThemeSettings />, "custom");
    await waitFor(() =>
      expect(screen.getByLabelText("背景の色")).toBeDefined(),
    );

    fireEvent.change(screen.getByLabelText("背景の色"), {
      target: { value: "#123456" },
    });

    const saved = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
    expect(saved).not.toBeNull();
    expect(saved).toContain("#123456");
  });

  it("restores defaults with the reset button", async () => {
    const { rerender } = render(<ThemeSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: /カスタム/ })).toBeDefined());
    await selectTheme(rerender, <ThemeSettings />, "custom");
    await waitFor(() =>
      expect(screen.getByLabelText("背景の色")).toBeDefined(),
    );

    fireEvent.change(screen.getByLabelText("背景の色"), {
      target: { value: "#123456" },
    });
    expect(localStorage.getItem(CUSTOM_THEME_STORAGE_KEY)).not.toBeNull();

    fireEvent.click(screen.getByText("デフォルトに戻す"));

    await waitFor(() =>
      expect(localStorage.getItem(CUSTOM_THEME_STORAGE_KEY)).toBeNull(),
    );
  });
});

