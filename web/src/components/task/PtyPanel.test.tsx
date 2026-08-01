import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { PtyPanel, ptyReconnectDelayMs } from "./PtyPanel";

// Mock xterm.js so the unit test does not need a real canvas implementation.
const writeMock = vi.fn();
const disposeMock = vi.fn();
const fitMock = vi.fn();
const clearMock = vi.fn();
const dataHandlers = new Set<(data: string) => void>();
const resizeHandlers = new Set<(dims: { cols: number; rows: number }) => void>();

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(() => ({
    open: vi.fn(),
    write: writeMock,
    clear: clearMock,
    dispose: disposeMock,
    onData: vi.fn((handler: (data: string) => void) => {
      dataHandlers.add(handler);
      return { dispose: () => { dataHandlers.delete(handler); } };
    }),
    onResize: vi.fn((handler: (dims: { cols: number; rows: number }) => void) => {
      resizeHandlers.add(handler);
      return { dispose: () => { resizeHandlers.delete(handler); } };
    }),
    loadAddon: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(() => ({ fit: fitMock })),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const eventSourceInstances: FakeEventSource[] = [];
class FakeEventSource {
  url = "";
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string | URL) {
    this.url = String(url);
    eventSourceInstances.push(this);
  }
  close() {
    this.closed = true;
  }
  addEventListener() { /* not used in these tests */ }
}
vi.stubGlobal("EventSource", FakeEventSource);

// ResizeObserver is not available in jsdom.
vi.stubGlobal("ResizeObserver", class {
  observe() {}
  disconnect() {}
});

const getComputedStyleBackup = window.getComputedStyle;
vi.stubGlobal("getComputedStyle", (el: Element) => {
  if (el === document.documentElement) {
    return {
      getPropertyValue: (name: string) => {
        const map: Record<string, string> = {
          "--surface": "#ffffff",
          "--muted": "#71717a",
        };
        return map[name] ?? "";
      },
    } as CSSStyleDeclaration;
  }
  return getComputedStyleBackup(el);
});

function mockFetchJson(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(() => Promise.resolve(body)),
  });
}

describe("PtyPanel", () => {
  afterEach(() => {
    cleanup();
    fetchMock.mockClear();
    writeMock.mockClear();
    disposeMock.mockClear();
    clearMock.mockClear();
    dataHandlers.clear();
    resizeHandlers.clear();
    eventSourceInstances.length = 0;
  });

  it("lists PTY sessions on mount", async () => {
    mockFetchJson(200, {
      sessions: [
        { id: "pty_1", title: "bash", cwd: "/proj", status: "running" },
      ],
    });

    render(<PtyPanel directory="C:/proj" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain("/api/pty-session");
    expect(call[0]).toContain("directory=C%3A%2Fproj");
    expect(await screen.findByText("bash")).toBeTruthy();
    expect(screen.getByRole("button", { name: "bash セッションを閉じる" })).toBeTruthy();
  });

  it("announces the initial loading state instead of showing an empty state", async () => {
    let resolveList: ((value: unknown) => void) | undefined;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );

    render(<PtyPanel directory="C:/proj" />);

    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(
      screen.queryByText("稼働中の PTY はありません。「新規」でターミナルを開始できます。"),
    ).toBeNull();

    resolveList?.({
      ok: true,
      status: 200,
      json: vi.fn(() => Promise.resolve({ sessions: [] })),
    });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("creates a new session when the new button is clicked", async () => {
    mockFetchJson(200, { sessions: [] }); // initial list
    mockFetchJson(200, { id: "pty_2" });   // create
    mockFetchJson(200, {
      sessions: [{ id: "pty_2", title: "bash", cwd: "/proj", status: "running" }],
    }); // refresh

    render(<PtyPanel directory="C:/proj" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("新規"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const createCall = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "POST",
    );
    expect(createCall).toBeTruthy();
    expect(createCall![0]).toContain("/api/pty-session");
    expect(JSON.parse(createCall![1].body)).toEqual({ directory: "C:/proj" });
  });

  it("does not create duplicate sessions from rapid clicks", async () => {
    mockFetchJson(200, { sessions: [] });
    let resolveCreate: ((value: unknown) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    mockFetchJson(200, { sessions: [] });

    render(<PtyPanel directory="C:/proj" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const createButton = screen.getAllByRole("button")[0]!;
    expect(createButton.className).toContain("min-h-11");
    expect(createButton.className).toContain("md:min-h-7");
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveCreate?.({
      ok: true,
      status: 200,
      json: vi.fn(() => Promise.resolve({ id: "pty_2" })),
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("does not delete the same PTY twice before the first close settles", async () => {
    mockFetchJson(200, {
      sessions: [{ id: "pty_1", title: "bash", cwd: "/proj", status: "running" }],
    });
    fetchMock.mockReturnValueOnce(
      new Promise(() => undefined),
    );

    render(<PtyPanel directory="C:/proj" />);
    const closeButton = await screen.findByTestId("close-pty-pty_1");
    expect(closeButton.className).toContain("min-h-11");
    expect(closeButton.className).toContain("min-w-11");
    fireEvent.click(closeButton);
    fireEvent.click(closeButton);

    expect(
      fetchMock.mock.calls.filter(([url, init]) =>
        String(url).includes("/api/pty-session") && init?.method === "DELETE",
      ),
    ).toHaveLength(1);
  });

  it("ignores SSE output after the terminal is unmounted", async () => {
    mockFetchJson(200, {
      sessions: [{ id: "pty_1", title: "bash", cwd: "/proj", status: "running" }],
    });

    const { unmount } = render(<PtyPanel directory="C:/proj" />);
    fireEvent.click(await screen.findByText("bash"));
    await waitFor(() => expect(eventSourceInstances.length).toBe(1));
    unmount();
    eventSourceInstances[0].onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ t: "o", d: "late output" }),
      }),
    );

    expect(writeMock).not.toHaveBeenCalledWith("late output");
  });

  it("opens the SSE stream when a session tab is clicked", async () => {
    mockFetchJson(200, {
      sessions: [{ id: "pty_1", title: "bash", cwd: "/proj", status: "running" }],
    });

    render(<PtyPanel directory="C:/proj" />);
    const tab = await screen.findByText("bash");
    fireEvent.click(tab);

    await waitFor(() => expect(eventSourceInstances.length).toBe(1));
    const es = eventSourceInstances[0] as unknown as FakeEventSource;
    expect(es.url).toContain("/api/pty-session/stream");
    expect(es.url).toContain("id=pty_1");

    // Simulate PTY output from the Engine through the BFF SSE frame.
    if (es.onmessage) {
      es.onmessage(new MessageEvent("message", {
        data: JSON.stringify({ t: "o", d: "hello" }),
      }));
    }
    expect(writeMock).toHaveBeenCalledWith("hello");
  });

  it("schedules a backoff reconnect on a transient stream error", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    mockFetchJson(200, {
      sessions: [{ id: "pty_1", title: "bash", cwd: "/proj", status: "running" }],
    });

    render(<PtyPanel directory="C:/proj" />);
    fireEvent.click(await screen.findByText("bash"));
    await waitFor(() => expect(eventSourceInstances.length).toBe(1));

    setTimeoutSpy.mockClear();
    eventSourceInstances[0].onerror?.();

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(500); // first backoff step
    // Clear the pending reconnect so no dangling timer fires after the test.
    clearTimeout(setTimeoutSpy.mock.results[0]?.value);
    setTimeoutSpy.mockRestore();
  });

  it("stops reconnecting after a PTY exit sentinel and refreshes the list", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    mockFetchJson(200, {
      sessions: [{ id: "pty_1", title: "bash", cwd: "/proj", status: "running" }],
    });

    render(<PtyPanel directory="C:/proj" />);
    fireEvent.click(await screen.findByText("bash"));
    await waitFor(() => expect(eventSourceInstances.length).toBe(1));
    mockFetchJson(200, { sessions: [] }); // refresh() triggered by the exit

    eventSourceInstances[0].onmessage?.(
      new MessageEvent("message", { data: JSON.stringify({ t: "exit" }) }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(eventSourceInstances[0].closed).toBe(true);

    // A later error must not schedule any reconnect.
    setTimeoutSpy.mockClear();
    eventSourceInstances[0].onerror?.();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it("closes a session and disposes the terminal", async () => {
    mockFetchJson(200, {
      sessions: [{ id: "pty_1", title: "bash", cwd: "/proj", status: "running" }],
    });
    mockFetchJson(200, { ok: true }); // delete
    mockFetchJson(200, { sessions: [] }); // refresh

    render(<PtyPanel directory="C:/proj" />);
    const tab = await screen.findByText("bash");
    fireEvent.click(tab);

    const closeButton = screen.getByTestId("close-pty-pty_1");
    fireEvent.click(closeButton);

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "DELETE",
      );
      expect(deleteCall).toBeTruthy();
    });
    expect(disposeMock).toHaveBeenCalled();
    expect(closeButton.getAttribute("aria-label")).toBeTruthy();
  });

  it("does not close a session when the server rejects the delete", async () => {
    mockFetchJson(200, {
      sessions: [{ id: "pty_1", title: "bash", cwd: "/proj", status: "running" }],
    });
    mockFetchJson(500, { error: "delete denied" });

    render(<PtyPanel directory="C:/proj" />);
    const closeButton = await screen.findByTestId("close-pty-pty_1");
    fireEvent.click(closeButton);

    expect((await screen.findByRole("alert")).textContent).toContain("delete denied");
    expect(screen.getByText("bash")).toBeTruthy();
  });

  it("drops a stale session list after switching directories", async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("C%3A%2Fold")) {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: vi.fn(() => Promise.resolve({
          sessions: [{ id: "pty_new", title: "new", cwd: "/new", status: "running" }],
        })),
      });
    });

    const { rerender } = render(<PtyPanel directory="C:/old" />);
    rerender(<PtyPanel directory="C:/new" />);

    expect(await screen.findByText("new")).toBeTruthy();
    resolveOld?.({
      ok: true,
      status: 200,
      json: vi.fn(() => Promise.resolve({
        sessions: [{ id: "pty_old", title: "old", cwd: "/old", status: "running" }],
      })),
    });
    await waitFor(() => expect(screen.queryByText("old")).toBeNull());
  });

  it("does not activate a session created for the previous directory", async () => {
    let resolveCreate: ((value: unknown) => void) | undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: vi.fn(() => Promise.resolve({ sessions: [] })),
      });
    });

    const { rerender } = render(<PtyPanel directory="C:/old" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole("button")[0]!);
    rerender(<PtyPanel directory="C:/new" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    resolveCreate?.({
      ok: true,
      status: 200,
      json: vi.fn(() => Promise.resolve({ id: "old-created" })),
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(eventSourceInstances).toHaveLength(0);
  });
});

describe("ptyReconnectDelayMs", () => {
  it("grows exponentially, caps, then gives up past the retry budget", () => {
    expect(ptyReconnectDelayMs(0)).toBe(500);
    expect(ptyReconnectDelayMs(1)).toBe(1000);
    expect(ptyReconnectDelayMs(2)).toBe(2000);
    expect(ptyReconnectDelayMs(3)).toBe(4000);
    expect(ptyReconnectDelayMs(4)).toBe(8000);
    expect(ptyReconnectDelayMs(5)).toBeNull();
    expect(ptyReconnectDelayMs(99)).toBeNull();
  });
});
