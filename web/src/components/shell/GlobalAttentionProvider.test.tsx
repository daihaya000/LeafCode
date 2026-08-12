import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GlobalAttentionProvider, useGlobalAttention } from "./GlobalAttentionProvider";
import type { AttentionItem } from "@/lib/attention";

const { getJsonMock, ocJsonMock, sendJsonMock } = vi.hoisted(() => ({
  getJsonMock: vi.fn(),
  ocJsonMock: vi.fn(),
  sendJsonMock: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  apiUrl: (p: string) => p,
  getJson: getJsonMock,
  ocJson: ocJsonMock,
  sendJson: sendJsonMock,
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
    sendJsonMock.mockReset();
    getJsonMock.mockResolvedValue({ tasks: [] });
    ocJsonMock.mockResolvedValue([]);
    sendJsonMock.mockResolvedValue({});
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

  it("restores v2 permissions from { data } envelopes when v1 is empty", async () => {
    getJsonMock.mockResolvedValue({
      tasks: [{ directory: "/repo", sessionId: "s1", title: "bg" }],
    });
    ocJsonMock.mockImplementation(async (path: string) => {
      if (path === "/question" || path === "/permission") return [];
      if (path === "/api/session/s1/permission") {
        return {
          data: [
            {
              id: "pv2",
              sessionID: "s1",
              permission: "edit",
              patterns: ["*.ts"],
            },
          ],
        };
      }
      if (path === "/api/session/s1/question") return { data: [] };
      return [];
    });
    let latest: AttentionItem[] = [];
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={(items) => (latest = items)} />
      </GlobalAttentionProvider>,
    );
    openConnection();
    await waitFor(() => {
      expect(latest.map((i) => i.request.id)).toContain("pv2");
      expect(latest.find((i) => i.request.id === "pv2")?.request.version).toBe(
        "v2",
      );
    });
  });

  it("auto-approves background permissions in フルアクセス", async () => {
    localStorage.setItem("webui:access-mode", "full");
    ocJsonMock.mockResolvedValue({});
    try {
      render(
        <GlobalAttentionProvider activeScope={null}>
          <TestConsumer onItems={() => undefined} />
        </GlobalAttentionProvider>,
      );
      act(() => {
        FakeEventSource.latest?.onmessage?.({
          data: JSON.stringify({
            type: "permission.asked",
            directory: "/repo",
            properties: {
              id: "p1",
              sessionID: "session-1",
              permission: "bash",
            },
          }),
        } as MessageEvent);
      });
      await waitFor(() =>
        expect(ocJsonMock).toHaveBeenCalledWith(
          expect.stringContaining("/permissions/p1"),
          "/repo",
          expect.objectContaining({ body: { response: "once" } }),
        ),
      );
    } finally {
      localStorage.removeItem("webui:access-mode");
    }
  });

  it("PATCHes edit ceiling for session.created under a known task without TaskView", async () => {
    localStorage.setItem("webui:access-mode", "ask");
    getJsonMock.mockResolvedValue({
      tasks: [
        {
          id: "task-1",
          directory: "/repo",
          sessionId: "parent",
          title: "background task",
        },
      ],
    });
    try {
      render(
        <GlobalAttentionProvider activeScope={null}>
          <TestConsumer onItems={() => undefined} />
        </GlobalAttentionProvider>,
      );
      openConnection();
      await waitFor(() => expect(getJsonMock).toHaveBeenCalled());

      act(() => {
        FakeEventSource.latest?.onmessage?.({
          data: JSON.stringify({
            type: "session.created",
            directory: "/repo",
            properties: {
              info: { id: "child-1", parentID: "parent" },
            },
          }),
        } as MessageEvent);
      });

      await waitFor(() =>
        expect(sendJsonMock).toHaveBeenCalledWith("POST", "/api/access-mode", {
          taskId: "task-1",
          sessionId: "parent",
          mode: "ask",
          ensureSessionIds: ["child-1"],
        }),
      );
    } finally {
      localStorage.removeItem("webui:access-mode");
    }
  });

  it("PATCHes nested grandchild session.created after tracking the child", async () => {
    localStorage.setItem("webui:access-mode", "ask");
    getJsonMock.mockResolvedValue({
      tasks: [
        {
          id: "task-1",
          directory: "/repo",
          sessionId: "parent",
          title: "background task",
        },
      ],
    });
    try {
      render(
        <GlobalAttentionProvider activeScope={null}>
          <TestConsumer onItems={() => undefined} />
        </GlobalAttentionProvider>,
      );
      openConnection();
      await waitFor(() => expect(getJsonMock).toHaveBeenCalled());

      act(() => {
        FakeEventSource.latest?.onmessage?.({
          data: JSON.stringify({
            type: "session.created",
            directory: "/repo",
            properties: {
              info: { id: "child-1", parentID: "parent" },
            },
          }),
        } as MessageEvent);
      });
      await waitFor(() =>
        expect(sendJsonMock).toHaveBeenCalledWith(
          "POST",
          "/api/access-mode",
          expect.objectContaining({ ensureSessionIds: ["child-1"] }),
        ),
      );
      sendJsonMock.mockClear();

      act(() => {
        FakeEventSource.latest?.onmessage?.({
          data: JSON.stringify({
            type: "session.created",
            directory: "/repo",
            properties: {
              info: { id: "grand-1", parentID: "child-1" },
            },
          }),
        } as MessageEvent);
      });

      await waitFor(() =>
        expect(sendJsonMock).toHaveBeenCalledWith("POST", "/api/access-mode", {
          taskId: "task-1",
          sessionId: "parent",
          mode: "ask",
          ensureSessionIds: ["grand-1"],
        }),
      );
    } finally {
      localStorage.removeItem("webui:access-mode");
    }
  });

  it("ignores session.created that is not under a known task root", async () => {
    getJsonMock.mockResolvedValue({
      tasks: [
        {
          id: "task-1",
          directory: "/repo",
          sessionId: "parent",
          title: "background task",
        },
      ],
    });
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={() => undefined} />
      </GlobalAttentionProvider>,
    );
    openConnection();
    await waitFor(() => expect(getJsonMock).toHaveBeenCalled());

    act(() => {
      FakeEventSource.latest?.onmessage?.({
        data: JSON.stringify({
          type: "session.created",
          directory: "/repo",
          properties: {
            info: { id: "orphan", parentID: "someone-else" },
          },
        }),
      } as MessageEvent);
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(sendJsonMock).not.toHaveBeenCalled();
  });

  it("フルアクセス切替後、キュー内の残り権限を一度だけ自動処理する", async () => {
    localStorage.setItem("webui:access-mode", "ask");
    localStorage.setItem("webui:subagent-permission", "allow");
    ocJsonMock.mockResolvedValue({});
    try {
      render(
        <GlobalAttentionProvider activeScope={null}>
          <TestConsumer onItems={() => undefined} />
        </GlobalAttentionProvider>,
      );
      act(() => {
        FakeEventSource.latest?.onmessage?.({
          data: JSON.stringify({
            type: "permission.asked",
            directory: "/repo",
            properties: {
              id: "p_bash",
              sessionID: "session-1",
              permission: "bash",
            },
          }),
        } as MessageEvent);
        FakeEventSource.latest?.onmessage?.({
          data: JSON.stringify({
            type: "permission.asked",
            directory: "/repo",
            properties: {
              id: "p_task",
              sessionID: "session-1",
              permission: "task",
            },
          }),
        } as MessageEvent);
      });
      expect(ocJsonMock).not.toHaveBeenCalled();

      act(() => {
        localStorage.setItem("webui:subagent-permission", "deny");
        window.dispatchEvent(
          new CustomEvent("webui:subagent-permission", { detail: "deny" }),
        );
        localStorage.setItem("webui:access-mode", "full");
        window.dispatchEvent(
          new CustomEvent("webui:access-mode", { detail: "full" }),
        );
      });

      await waitFor(() => {
        expect(ocJsonMock).toHaveBeenCalledWith(
          expect.stringContaining("/permissions/p_bash"),
          "/repo",
          expect.objectContaining({ body: { response: "once" } }),
        );
        expect(ocJsonMock).toHaveBeenCalledWith(
          expect.stringContaining("/permissions/p_task"),
          "/repo",
          expect.objectContaining({ body: { response: "reject" } }),
        );
      });
      expect(
        ocJsonMock.mock.calls.filter(([path]) =>
          String(path).includes("/permissions/"),
        ),
      ).toHaveLength(2);
    } finally {
      localStorage.removeItem("webui:access-mode");
      localStorage.removeItem("webui:subagent-permission");
    }
  });

  it("skips auto-reply when the request was already answered elsewhere", async () => {
    const { rememberReplied } = await import("@/lib/recently-replied");
    localStorage.setItem("webui:access-mode", "ask");
    ocJsonMock.mockResolvedValue({});
    let latest: AttentionItem[] = [];
    try {
      render(
        <GlobalAttentionProvider activeScope={null}>
          <TestConsumer onItems={(items) => (latest = items)} />
        </GlobalAttentionProvider>,
      );
      act(() => {
        FakeEventSource.latest?.onmessage?.({
          data: JSON.stringify({
            type: "permission.asked",
            directory: "/repo",
            properties: {
              id: "p_done",
              sessionID: "session-1",
              permission: "bash",
            },
          }),
        } as MessageEvent);
      });
      await waitFor(() =>
        expect(latest.some((i) => i.request.id === "p_done")).toBe(true),
      );

      rememberReplied("p_done", "session-1");
      act(() => {
        localStorage.setItem("webui:access-mode", "full");
        window.dispatchEvent(
          new CustomEvent("webui:access-mode", { detail: "full" }),
        );
      });

      await waitFor(() =>
        expect(latest.some((i) => i.request.id === "p_done")).toBe(false),
      );
      expect(ocJsonMock).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem("webui:access-mode");
    }
  });

  it("restores child session v2 permissions into the global queue", async () => {
    getJsonMock.mockResolvedValue({
      tasks: [{ directory: "/repo", sessionId: "parent", title: "root task" }],
    });
    ocJsonMock.mockImplementation(async (path: string) => {
      if (path === "/question" || path === "/permission") return [];
      if (path === "/session/parent/children") {
        return { data: [{ id: "child-1" }] };
      }
      if (path === "/api/session/parent/question") return { data: [] };
      if (path === "/api/session/parent/permission") return { data: [] };
      if (path === "/api/session/child-1/question") return { data: [] };
      if (path === "/api/session/child-1/permission") {
        return {
          data: [
            {
              id: "child-perm",
              sessionID: "child-1",
              permission: "bash",
              patterns: ["npm test"],
            },
          ],
        };
      }
      return [];
    });
    let latest: AttentionItem[] = [];
    render(
      <GlobalAttentionProvider activeScope={{ directory: "/repo", sessionId: "parent" }}>
        <TestConsumer onItems={(items) => (latest = items)} />
      </GlobalAttentionProvider>,
    );
    openConnection();
    await waitFor(() => {
      const item = latest.find((i) => i.request.id === "child-perm");
      expect(item?.kind).toBe("permission");
      expect(item?.request.sessionID).toBe("child-1");
      expect(item?.request.version).toBe("v2");
    });
  });

  it("restores grandchild session v2 permissions into the global queue", async () => {
    getJsonMock.mockResolvedValue({
      tasks: [{ directory: "/repo", sessionId: "parent", title: "root task" }],
    });
    ocJsonMock.mockImplementation(async (path: string) => {
      if (path === "/question" || path === "/permission") return [];
      if (path === "/session/parent/children") {
        return { data: [{ id: "child-1" }] };
      }
      if (path === "/session/child-1/children") {
        return { data: [{ id: "grand-1" }] };
      }
      if (path === "/api/session/parent/question") return { data: [] };
      if (path === "/api/session/parent/permission") return { data: [] };
      if (path === "/api/session/child-1/question") return { data: [] };
      if (path === "/api/session/child-1/permission") return { data: [] };
      if (path === "/api/session/grand-1/question") return { data: [] };
      if (path === "/api/session/grand-1/permission") {
        return {
          data: [
            {
              id: "grand-perm",
              sessionID: "grand-1",
              permission: "edit",
              patterns: ["*.ts"],
            },
          ],
        };
      }
      return [];
    });
    let latest: AttentionItem[] = [];
    render(
      <GlobalAttentionProvider activeScope={{ directory: "/repo", sessionId: "parent" }}>
        <TestConsumer onItems={(items) => (latest = items)} />
      </GlobalAttentionProvider>,
    );
    openConnection();
    await waitFor(() => {
      const item = latest.find((i) => i.request.id === "grand-perm");
      expect(item?.kind).toBe("permission");
      if (item?.kind !== "permission") {
        throw new Error("expected grandchild permission item");
      }
      expect(item.request.sessionID).toBe("grand-1");
      expect(item.request.permission).toBe("edit");
      expect(item.request.version).toBe("v2");
    });
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
    ocJsonMock.mockImplementation(async (path: string) => {
      if (path === "/question" || path.startsWith("/api/session/")) {
        if (path.includes("/permission")) return [];
        return [{ id: "q1", sessionID: "s1", questions: [] }];
      }
      if (path === "/permission") return [];
      return [];
    });
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
    expect(latest[0]?.kind).toBe("question");
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
