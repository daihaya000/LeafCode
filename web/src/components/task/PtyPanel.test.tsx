import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { PtyPanel } from "./PtyPanel";

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

const eventSourceInstances: EventSource[] = [];
class FakeEventSource {
  url = "";
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string | URL) {
    this.url = String(url);
    eventSourceInstances.push(this as unknown as EventSource);
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
  });
});
