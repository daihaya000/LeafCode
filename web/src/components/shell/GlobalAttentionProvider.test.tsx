import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GlobalAttentionProvider, useGlobalAttention } from "./GlobalAttentionProvider";
import type { AttentionItem } from "@/lib/attention";

const { getJsonMock, ocJsonMock } = vi.hoisted(() => ({
  getJsonMock: vi.fn(),
  ocJsonMock: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  apiUrl: (p: string) => p,
  getJson: getJsonMock,
  ocJson: ocJsonMock,
}));

const TestConsumer = ({ onItems }: { onItems: (items: AttentionItem[]) => void }) => {
  const { items, open, openNext, setOpen } = useGlobalAttention();
  onItems(items);
  return (
    <>
      <input aria-label="composer" />
      <output data-testid="open-state">{open ? "open" : "closed"}</output>
      <button onClick={openNext}>open</button>
      <button onClick={() => setOpen(false)}>close</button>
    </>
  );
};

class FakeEventSource {
  static latest: FakeEventSource | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  close = vi.fn(() => {
    this.readyState = 2;
  });
  private listeners = new Map<string, Array<() => void>>();

  constructor() {
    FakeEventSource.latest = this;
  }

  addEventListener(type: string, listener: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: () => void) {
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter((l) => l !== listener),
    );
  }
}

function emitQuestion(id = "q1") {
  act(() => {
    FakeEventSource.latest?.onmessage?.({
      data: JSON.stringify({
        type: "question.asked",
        directory: "/repo",
        properties: { id, sessionID: "session-1", questions: [] },
      }),
    } as MessageEvent);
  });
}

function openConnection() {
  act(() => {
    FakeEventSource.latest?.onopen?.();
  });
}

describe("GlobalAttentionProvider", () => {
  beforeEach(() => {
    FakeEventSource.latest = null;
    vi.stubGlobal("EventSource", FakeEventSource);
    getJsonMock.mockReset();
    ocJsonMock.mockReset();
    getJsonMock.mockResolvedValue({ tasks: [] });
    ocJsonMock.mockResolvedValue([]);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("provides an empty queue initially", () => {
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={(items) => expect(items).toEqual([])} />
      </GlobalAttentionProvider>,
    );
  });

  it("opens after focus leaves an input that deferred auto-open", async () => {
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={() => undefined} />
      </GlobalAttentionProvider>,
    );
    const composer = screen.getByRole("textbox", { name: "composer" });
    composer.focus();

    emitQuestion();
    expect(screen.getByTestId("open-state").textContent).toBe("closed");

    composer.blur();
    fireEvent.focusOut(composer);
    await waitFor(() => expect(screen.getByTestId("open-state").textContent).toBe("open"));
  });

  it("does not reopen a manually closed queue on later focus changes", async () => {
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={() => undefined} />
      </GlobalAttentionProvider>,
    );
    emitQuestion();
    await waitFor(() => expect(screen.getByTestId("open-state").textContent).toBe("open"));
    fireEvent.click(screen.getByRole("button", { name: "close" }));

    const composer = screen.getByRole("textbox", { name: "composer" });
    composer.focus();
    composer.blur();
    fireEvent.focusOut(composer);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("open-state").textContent).toBe("closed");
  });

  it("restores pending questions on first connect", async () => {
    getJsonMock.mockResolvedValue({ tasks: [{ directory: "/repo", sessionId: "s1" }] });
    ocJsonMock.mockImplementation(async (path: string, directory: string) => {
      if (path === "/question" && directory === "/repo") {
        return [{ id: "q1", sessionID: "s1", questions: [] }];
      }
      return [];
    });
    let latest: AttentionItem[] = [];
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={(items) => (latest = items)} />
      </GlobalAttentionProvider>,
    );
    openConnection();
    await waitFor(() => expect(latest.map((i) => i.request.id)).toContain("q1"));
  });

  it("restores pending questions after a reconnect", async () => {
    vi.useFakeTimers();
    getJsonMock.mockResolvedValue({ tasks: [{ directory: "/repo", sessionId: "s1" }] });
    ocJsonMock.mockResolvedValue([{ id: "q1", sessionID: "s1", questions: [] }]);
    let latest: AttentionItem[] = [];
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={(items) => (latest = items)} />
      </GlobalAttentionProvider>,
    );
    const es1 = FakeEventSource.latest;
    await act(async () => {
      es1?.onerror?.();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const es2 = FakeEventSource.latest;
    expect(es2).not.toBe(es1);
    openConnection();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(latest.map((i) => i.request.id)).toContain("q1");
    vi.useRealTimers();
  });

  it("does not duplicate a question present from both SSE and REST", async () => {
    getJsonMock.mockResolvedValue({ tasks: [{ directory: "/repo", sessionId: "s1" }] });
    ocJsonMock.mockResolvedValue([{ id: "q1", sessionID: "s1", questions: [] }]);
    let latest: AttentionItem[] = [];
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={(items) => (latest = items)} />
      </GlobalAttentionProvider>,
    );
    emitQuestion("q1");
    openConnection();
    await waitFor(() => expect(latest).toHaveLength(1));
    expect(latest.map((i) => i.request.id)).toEqual(["q1"]);
  });

  it("removes a question resolved during disconnect", async () => {
    getJsonMock.mockResolvedValue({ tasks: [{ directory: "/repo", sessionId: "s1" }] });
    ocJsonMock.mockResolvedValue([]);
    let latest: AttentionItem[] = [];
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={(items) => (latest = items)} />
      </GlobalAttentionProvider>,
    );
    emitQuestion("q1");
    await waitFor(() => expect(latest).toHaveLength(1));
    openConnection();
    await waitFor(() => expect(latest).toHaveLength(0));
  });

  it("keeps existing items when a directory sync fails", async () => {
    getJsonMock.mockResolvedValue({
      tasks: [
        { directory: "/a", sessionId: "s1" },
        { directory: "/b", sessionId: "s2" },
      ],
    });
    ocJsonMock.mockImplementation(async (path: string, directory: string) => {
      if (directory === "/a") throw new Error("boom");
      return [];
    });
    let latest: AttentionItem[] = [];
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={(items) => (latest = items)} />
      </GlobalAttentionProvider>,
    );
    act(() => {
      FakeEventSource.latest?.onmessage?.({
        data: JSON.stringify({
          type: "question.asked",
          directory: "/a",
          properties: { id: "qa", sessionID: "s1", questions: [] },
        }),
      } as MessageEvent);
      FakeEventSource.latest?.onmessage?.({
        data: JSON.stringify({
          type: "question.asked",
          directory: "/b",
          properties: { id: "qb", sessionID: "s2", questions: [] },
        }),
      } as MessageEvent);
    });
    await waitFor(() => expect(latest).toHaveLength(2));
    openConnection();
    await waitFor(() => expect(latest.map((i) => i.request.id)).toEqual(["qa"]));
  });
});
