import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySettings } from "./MemorySettings";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiHandler({
  memories,
  workspaces,
  sessions,
}: {
  memories: unknown[];
  workspaces: unknown[];
  sessions: unknown[];
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/api/workspaces/") && url.includes("/sessions")) {
      return jsonResponse({ sessions });
    }
    if (url.includes("/api/workspaces")) {
      return jsonResponse({ workspaces });
    }
    if (url.includes("/api/memory/extract")) {
      return jsonResponse({ result: { created: 2, skipped: 2 } });
    }
    if (url.includes("/api/memory/") && (method === "DELETE" || method === "POST")) {
      return jsonResponse({ ok: true });
    }
    if (url.includes("/api/memory/")) {
      return jsonResponse({ memory: {} });
    }
    if (url.includes("/api/memory")) {
      return jsonResponse({ memories });
    }
    return jsonResponse({}, 404);
  });
}

describe("MemorySettings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", apiHandler({ memories: [], workspaces: [], sessions: [] }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lists the workspace and approved/candidate memories across tabs", async () => {
    const fetchMock = apiHandler({
        workspaces: [
          { id: "ws-1", displayName: "Project A", absolutePath: "C:/repo", status: "active" },
        ],
        sessions: [
          { workspaceId: "ws-1", opencodeSessionId: "session-1", title: "Session A", favorite: true, updatedAt: "x" },
        ],
        memories: [
          {
            id: "m1", workspaceId: "ws-1", kind: "fact", content: "Use pnpm.",
            sourceSessionId: null, provenance: "manual", approved: true,
            createdAt: 1700000000000, updatedAt: 1700000000000, lastUsedAt: null, useCount: 3,
            revision: 0,
          },
          {
            id: "m2", workspaceId: "ws-1", kind: "lesson", content: "Always lint before commit.",
            sourceSessionId: "session-1", provenance: "auto-extract", approved: false,
            createdAt: 1700000000000, updatedAt: 1700000000000, lastUsedAt: null, useCount: 1,
            revision: 0,
          },
        ],
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemorySettings />);

    // Approved tab shows the approved memory.
    await waitFor(() => expect(screen.getByText("Use pnpm.")).toBeTruthy());
    expect(screen.getByText("3回", { exact: false })).toBeTruthy();

    // Candidate is hidden until we switch to the candidates tab.
    expect(screen.queryByText("Always lint before commit.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /候補/ }));
    expect(await screen.findByText("Always lint before commit.")).toBeTruthy();
  });

  it("starts edit from a row and saves via PATCH", async () => {
    const fetchMock = apiHandler({
        workspaces: [{ id: "ws-1", displayName: "P", absolutePath: "C:/r", status: "active" }],
        sessions: [],
        memories: [
          {
            id: "m1", workspaceId: "ws-1", kind: "fact", content: "Old", sourceSessionId: null,
            provenance: "manual", approved: true, createdAt: 1, updatedAt: 1, lastUsedAt: null, useCount: 0,
            revision: 0,
          },
        ],
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemorySettings />);
    await waitFor(() => expect(screen.getByText("Old")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "New content" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const patchCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input).includes("/api/memory/") && init?.method === "PATCH",
      );
      expect(call).toBeTruthy();
      return call;
    });
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      content: "New content",
      expectedRevision: 0,
    });
  });

  it("runs a manual extraction with the selected workspace and session", async () => {
    const fetchMock = apiHandler({
        workspaces: [{ id: "ws-1", displayName: "P", absolutePath: "/r", status: "active" }],
        sessions: [
          { workspaceId: "ws-1", opencodeSessionId: "session-9", title: "Sess", favorite: false, updatedAt: "x" },
        ],
        memories: [],
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemorySettings />);
    // Auto-selection loads sessions for the first workspace; wait for a session option.
    await waitFor(() => expect(screen.getByText("Sess")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("抽出元セッション"), {
      target: { value: "session-9" },
    });
    const extractButton = await waitFor(() => {
      const b = screen.getByRole("button", { name: "今すぐ抽出" }) as HTMLButtonElement;
      expect(b.disabled).toBe(false);
      return b;
    });
    fireEvent.click(extractButton);

    const extract = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input).includes("/api/memory/extract") && init?.method === "POST",
      );
      expect(call).toBeTruthy();
      return call;
    });
    expect(JSON.parse(String(extract?.[1]?.body))).toMatchObject({
      workspaceId: "ws-1",
      sessionId: "session-9",
    });
    await screen.findByText(/抽出完了/);
  });
});
