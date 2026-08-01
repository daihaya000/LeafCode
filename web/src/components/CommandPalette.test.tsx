import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("does not let an aborted file search clear newer results", async () => {
    vi.useFakeTimers();
    let rejectFirst!: (error: unknown) => void;
    const first = new Promise<Response>((_, reject) => {
      rejectFirst = reject;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(["new-result.ts"]), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(getJson).mockResolvedValue({ tasks: [] });

    render(<CommandPalette directory="/repo" />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getAllByRole("textbox").at(-1)!;
    fireEvent.change(input, { target: { value: "first" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    fireEvent.change(input, { target: { value: "second" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await act(async () => {
      rejectFirst(new TypeError("aborted"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("new-result.ts")).toBeTruthy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("restores focus to the opener after closing", async () => {
    cleanup();
    vi.mocked(getJson).mockResolvedValue({ tasks: [] });
    render(
      <>
        <button type="button">Opener</button>
        <CommandPalette />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0));
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("locks background scrolling while open and restores it after closing", async () => {
    vi.mocked(getJson).mockResolvedValue({ tasks: [] });
    document.body.style.overflow = "auto";
    render(<CommandPalette />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(document.body.style.overflow).toBe("auto"));
  });
});
