import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostLogPanel } from "./HostLogPanel";

const { timedFetch, copyText } = vi.hoisted(() => ({
  timedFetch: vi.fn(),
  copyText: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/client", () => ({ timedFetch }));

vi.mock("@/lib/clipboard", () => ({
  copyText,
}));

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

/** Matches a single log-line <p> by its exact rendered text ("[source] text"). */
function findLogLine(text: string) {
  return screen.getByText(
    (_, element) =>
      element?.tagName === "P" && element.textContent === text,
  );
}

describe("HostLogPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    timedFetch.mockReset();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("is always expanded and starts polling on mount", async () => {
    timedFetch.mockResolvedValue(jsonResponse({ entries: [], nextSeq: 0 }));
    render(<HostLogPanel />);
    expect(screen.getByRole("heading", { name: "ホストログ" })).toBeTruthy();
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(1));
  });

  it("polls and renders entries once expanded", async () => {
    timedFetch.mockResolvedValue(
      jsonResponse({
        entries: [
          { seq: 1, ts: 1, source: "caddy", level: "error", text: "port busy" },
        ],
        nextSeq: 1,
      }),
    );

    render(<HostLogPanel />);

    await waitFor(() => expect(timedFetch).toHaveBeenCalled());
    await waitFor(() => findLogLine("[caddy] port busy"));
    expect(timedFetch).toHaveBeenCalledWith(
      "/api/host/logs",
      expect.objectContaining({ timeoutMs: 3000 }),
    );
  });

  it("does not steal the scroll position while the user reads older logs", async () => {
    timedFetch
      .mockResolvedValueOnce(
        jsonResponse({
          entries: [{ seq: 1, ts: 1, source: "host", level: "log", text: "first" }],
          nextSeq: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          entries: [{ seq: 2, ts: 2, source: "host", level: "log", text: "second" }],
          nextSeq: 2,
        }),
      );

    render(<HostLogPanel />);
    await waitFor(() => findLogLine("[host] first"));
    const viewport = document.querySelector(".max-h-64") as HTMLDivElement;
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 300 });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);

    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => findLogLine("[host] second"));
    expect(viewport.scrollTop).toBe(100);
  });

  it("uses the since cursor from nextSeq on subsequent polls", async () => {
    timedFetch
      .mockResolvedValueOnce(
        jsonResponse({
          entries: [{ seq: 1, ts: 1, source: "host", level: "log", text: "a" }],
          nextSeq: 1,
        }),
      )
      .mockResolvedValue(
        jsonResponse({
          entries: [{ seq: 2, ts: 2, source: "host", level: "log", text: "b" }],
          nextSeq: 2,
        }),
      );

    render(<HostLogPanel />);
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(2));
    expect(timedFetch).toHaveBeenLastCalledWith(
      "/api/host/logs?since=1",
      expect.anything(),
    );
    await waitFor(() => findLogLine("[host] a"));
    findLogLine("[host] b");
  });

  it("does not overlap a slow poll with the next interval", async () => {
    let resolveFirst: (value: Response) => void = () => {};
    timedFetch
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => { resolveFirst = resolve; }),
      )
      .mockResolvedValue(jsonResponse({ entries: [], nextSeq: 0 }));

    render(<HostLogPanel />);
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(6000);
    expect(timedFetch).toHaveBeenCalledTimes(1);

    resolveFirst(jsonResponse({ entries: [], nextSeq: 0 }));
    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(2));
  });

  it("shows a fetch error and stops accumulating entries", async () => {
    timedFetch.mockResolvedValue(
      jsonResponse({ error: "ホストが見つかりません" }, false, 502),
    );

    render(<HostLogPanel />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ホストが見つかりません");
  });

  it("offers a manual retry after a fetch error", async () => {
    timedFetch
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue(jsonResponse({ entries: [], nextSeq: 0 }));

    render(<HostLogPanel />);

    const retry = await screen.findByRole("button", { name: "再試行" });
    fireEvent.click(retry);
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(2));
  });

  it("clears the client-side view without refetching history", async () => {
    timedFetch.mockResolvedValue(
      jsonResponse({
        entries: [{ seq: 1, ts: 1, source: "host", level: "log", text: "line one" }],
        nextSeq: 1,
      }),
    );

    render(<HostLogPanel />);
    expect(await screen.findByText(/line one/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "表示をクリア" }));
    expect(screen.queryByText(/line one/)).toBeNull();
  });

  it("keeps each log entry on its own line when copied", async () => {
    timedFetch.mockResolvedValue(
      jsonResponse({
        entries: [
          { seq: 1, ts: 1, source: "host", level: "log", text: "first" },
          { seq: 2, ts: 2, source: "opencode", level: "error", text: "second" },
        ],
        nextSeq: 2,
      }),
    );

    render(<HostLogPanel />);
    await waitFor(() => findLogLine("[host] first"));

    fireEvent.click(screen.getByRole("button", { name: "コピー" }));
    await waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("[host] first\n[opencode] second"),
    );
  });

  it("pauses polling while hidden and resumes when visible", async () => {
    timedFetch.mockResolvedValue(jsonResponse({ entries: [], nextSeq: 0 }));
    render(<HostLogPanel />);
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(6000);
    expect(timedFetch).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(timedFetch).toHaveBeenCalledTimes(2));
  });
});
