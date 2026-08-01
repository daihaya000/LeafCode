import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import { getJson } from "@/lib/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }),
}));

vi.mock("@/lib/client", () => ({
  getJson: vi.fn(),
}));

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading status instead of a false empty result while tasks load", async () => {
    vi.mocked(getJson).mockReturnValue(new Promise(() => undefined));
    render(<CommandPalette />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("textbox", { name: "コマンドを検索" });
    fireEvent.change(input, { target: { value: "does-not-match" } });

    expect((await screen.findByRole("status")).textContent).toContain("検索中…");
    expect(screen.getByRole("list").getAttribute("aria-busy")).toBe("true");
  });

  it("keeps the active keyboard result visible as the selection moves", async () => {
    vi.mocked(getJson).mockResolvedValue({ tasks: [] });
    render(<CommandPalette />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("textbox", { name: "コマンドを検索" });
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    fireEvent.keyDown(input, { key: "ArrowDown" });

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(screen.getAllByRole("button")[1]?.getAttribute("aria-current")).toBe("true");
  });
});
