import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStaleCacheForTests } from "@/lib/stale-cache";
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
  writeApproval = false,
  memoryEnabled = true,
  extractionRuns = [],
  unreadExtractionCount = 0,
  consolidate = { scanned: 0, removed: 0, remaining: 0 },
}: {
  memories: unknown[];
  workspaces: unknown[];
  sessions: unknown[];
  writeApproval?: boolean;
  memoryEnabled?: boolean;
  extractionRuns?: unknown[];
  unreadExtractionCount?: number;
  consolidate?: { scanned: number; removed: number; remaining: number };
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/api/settings/memory.enabled")) {
      return method === "PUT"
        ? jsonResponse({ ok: true })
        : jsonResponse({ value: memoryEnabled ? null : "0" });
    }
    if (url.includes("/api/settings/memory.write_approval")) {
      return method === "PUT"
        ? jsonResponse({ ok: true })
        : jsonResponse({ value: writeApproval ? "1" : null });
    }
    if (url.includes("/api/workspaces/") && url.includes("/sessions")) {
      return jsonResponse({ sessions });
    }
    if (url.includes("/api/workspaces")) {
      return jsonResponse({ workspaces });
    }
    if (url.includes("/api/memory/extractions/read")) {
      return jsonResponse({ marked: unreadExtractionCount, unreadCount: 0 });
    }
    if (url.includes("/api/memory/extractions")) {
      return jsonResponse({ runs: extractionRuns, unreadCount: unreadExtractionCount });
    }
    if (url.includes("/api/memory/extract")) {
      return jsonResponse({ result: { created: 2, skipped: 2 } });
    }
    if (url.includes("/api/memory/purge")) {
      return jsonResponse({ removed: (memories as unknown[]).length });
    }
    if (url.includes("/api/memory/consolidate")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { dryRun?: boolean };
      return jsonResponse({ ...consolidate, dryRun: body.dryRun !== false });
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
    // `/api/settings/` (and friends) is stale-cached (persist: true);
    // without this the memory cache leaks the previous test's response.
    resetStaleCacheForTests();
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

    expect(screen.getByText(/セッションやタスクをまたいで保持します/)).toBeTruthy();
    // Scope is the project, so the UI must say so: a workspace is one task.
    expect(screen.getByText(/メモリはプロジェクト単位で共有されます/)).toBeTruthy();
    expect(screen.getByText(/自動保存が有効です/)).toBeTruthy();
    expect(screen.getByLabelText("メモリの保存前確認")).toBeTruthy();

    // Approved tab shows the approved memory.
    await waitFor(() => expect(screen.getByText("Use pnpm.")).toBeTruthy());
    expect(screen.getByText("3回", { exact: false })).toBeTruthy();

    // Candidate is hidden until we switch to the candidates tab.
    expect(screen.queryByText("Always lint before commit.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^候補 \(/ }));
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
      const b = screen.getByRole("button", { name: "メモリを抽出" }) as HTMLButtonElement;
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
    await screen.findByText(/自動保存完了/);
  });

  it("previews duplicates before deleting them and honours a cancel", async () => {
    const fetchMock = apiHandler({
      workspaces: [{ id: "ws-1", displayName: "P", absolutePath: "/r", status: "active" }],
      sessions: [],
      memories: [],
      consolidate: { scanned: 10, removed: 4, remaining: 6 },
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirmMock = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirmMock);

    render(<MemorySettings />);
    const button = await waitFor(() => {
      const b = screen.getByRole("button", { name: "重複を整理" }) as HTMLButtonElement;
      expect(b.disabled).toBe(false);
      return b;
    });
    fireEvent.click(button);

    // Declining the confirmation must leave the data untouched: dry run only.
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock.mock.calls[0][0]).toContain("4件");
    await screen.findByText(/重複 4件（未削除）/);
    const posts = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).includes("/api/memory/consolidate") && init?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
      workspaceId: "ws-1",
      dryRun: true,
    });
  });

  it("deletes duplicates after the confirmation is accepted", async () => {
    const fetchMock = apiHandler({
      workspaces: [{ id: "ws-1", displayName: "P", absolutePath: "/r", status: "active" }],
      sessions: [],
      memories: [],
      consolidate: { scanned: 10, removed: 4, remaining: 6 },
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    render(<MemorySettings />);
    fireEvent.click(
      await waitFor(() => {
        const b = screen.getByRole("button", { name: "重複を整理" }) as HTMLButtonElement;
        expect(b.disabled).toBe(false);
        return b;
      }),
    );

    await screen.findByText(/重複 4件を削除しました（残り 6件）/);
    const bodies = fetchMock.mock.calls
      .filter(
        ([input, init]) =>
          String(input).includes("/api/memory/consolidate") && init?.method === "POST",
      )
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toEqual([
      { workspaceId: "ws-1", dryRun: true },
      { workspaceId: "ws-1", dryRun: false },
    ]);
  });

  it("does not ask for confirmation when there is nothing to merge", async () => {
    const fetchMock = apiHandler({
      workspaces: [{ id: "ws-1", displayName: "P", absolutePath: "/r", status: "active" }],
      sessions: [],
      memories: [],
      consolidate: { scanned: 7, removed: 0, remaining: 7 },
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);

    render(<MemorySettings />);
    fireEvent.click(
      await waitFor(() => {
        const b = screen.getByRole("button", { name: "重複を整理" }) as HTMLButtonElement;
        expect(b.disabled).toBe(false);
        return b;
      }),
    );

    await screen.findByText(/同義の重複は見つかりませんでした/);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("toggles the shared write approval setting", async () => {
    const fetchMock = apiHandler({
      workspaces: [{ id: "ws-1", displayName: "P", absolutePath: "/r", status: "active" }],
      sessions: [],
      memories: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemorySettings />);
    const checkbox = await screen.findByLabelText("メモリの保存前確認");
    await waitFor(() => expect((checkbox as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(checkbox);

    const putCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).includes("/api/settings/memory.write_approval") &&
          init?.method === "PUT",
      );
      expect(call).toBeTruthy();
      return call;
    });
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({ value: "1" });
    expect(await screen.findByText(/保存前の確認が有効/)).toBeTruthy();
  });

  it("turns the memory layer off and stops offering extraction", async () => {
    const fetchMock = apiHandler({
      workspaces: [{ id: "ws-1", displayName: "P", absolutePath: "/r", status: "active" }],
      sessions: [
        { workspaceId: "ws-1", opencodeSessionId: "session-9", title: "Sess", favorite: false, updatedAt: "x" },
      ],
      memories: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemorySettings />);
    const toggle = await screen.findByLabelText("メモリ機能");
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    fireEvent.click(toggle);

    const putCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).includes("/api/settings/memory.enabled") && init?.method === "PUT",
      );
      expect(call).toBeTruthy();
      return call;
    });
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({ value: "0" });
    expect(await screen.findByText(/保存済みのメモリは残ります/)).toBeTruthy();

    // Extraction must be unavailable while the layer is off: the API refuses it
    // anyway, so the button should not invite a wasted round trip.
    fireEvent.change(screen.getByLabelText("抽出元セッション"), {
      target: { value: "session-9" },
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "メモリを抽出" }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(
      (screen.getByLabelText("メモリの保存前確認") as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("loads the disabled state from the server and keeps stored memories visible", async () => {
    const fetchMock = apiHandler({
      workspaces: [{ id: "ws-1", displayName: "P", absolutePath: "/r", status: "active" }],
      sessions: [],
      memoryEnabled: false,
      memories: [
        {
          id: "m1", workspaceId: "ws-1", kind: "fact", content: "残るメモリ", sourceSessionId: null,
          provenance: "manual", approved: true, createdAt: 1, updatedAt: 1, lastUsedAt: null,
          useCount: 0, revision: 0,
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemorySettings />);
    const toggle = await screen.findByLabelText("メモリ機能");
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
    expect(screen.getByText(/メモリ機能は無効です/)).toBeTruthy();
    // Disabling is not deleting: the row stays listed so it can be reviewed.
    expect(await screen.findByText("残るメモリ")).toBeTruthy();
  });

  it("deletes every memory in the scope after the confirmation is accepted", async () => {
    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);
    const fetchMock = apiHandler({
      workspaces: [{ id: "ws-1", displayName: "Project A", absolutePath: "/r", status: "active" }],
      sessions: [],
      memories: [
        {
          id: "m1", workspaceId: "ws-1", kind: "fact", content: "A", sourceSessionId: null,
          provenance: "manual", approved: true, createdAt: 1, updatedAt: 1, lastUsedAt: null,
          useCount: 0, revision: 0,
        },
        {
          id: "m2", workspaceId: "ws-1", kind: "lesson", content: "B", sourceSessionId: null,
          provenance: "auto-extract", approved: false, createdAt: 1, updatedAt: 1, lastUsedAt: null,
          useCount: 0, revision: 0,
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemorySettings />);
    const purgeButton = await screen.findByRole("button", { name: /すべて削除（2件）/ });
    fireEvent.click(purgeButton);

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    // The confirmation names the project and the exact damage.
    expect(confirmMock.mock.calls[0][0]).toContain("Project A");
    expect(confirmMock.mock.calls[0][0]).toContain("2件");

    const purge = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        String(input).includes("/api/memory/purge"),
      );
      expect(call).toBeTruthy();
      return call;
    });
    expect(JSON.parse(String(purge?.[1]?.body))).toEqual({
      workspaceId: "ws-1",
      confirm: true,
    });
    expect(await screen.findByText(/2件のメモリを削除しました/)).toBeTruthy();
  });

  it("does not delete anything when the purge confirmation is cancelled", async () => {
    const confirmMock = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirmMock);
    const fetchMock = apiHandler({
      workspaces: [{ id: "ws-1", displayName: "P", absolutePath: "/r", status: "active" }],
      sessions: [],
      memories: [
        {
          id: "m1", workspaceId: "ws-1", kind: "fact", content: "A", sourceSessionId: null,
          provenance: "manual", approved: true, createdAt: 1, updatedAt: 1, lastUsedAt: null,
          useCount: 0, revision: 0,
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemorySettings />);
    fireEvent.click(await screen.findByRole("button", { name: /すべて削除（1件）/ }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("/api/memory/purge")),
    ).toBe(false);
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("loads review mode from the server setting", async () => {
    const fetchMock = apiHandler({
      workspaces: [{ id: "ws-1", displayName: "P", absolutePath: "/r", status: "active" }],
      sessions: [],
      memories: [],
      writeApproval: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemorySettings />);
    const checkbox = await screen.findByLabelText("メモリの保存前確認");
    await waitFor(() => expect((checkbox as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText(/保存前の確認が有効です/)).toBeTruthy();
  });

  it("shows unread extraction results and marks them read explicitly", async () => {
    const fetchMock = apiHandler({
      workspaces: [{ id: "ws-1", displayName: "P", absolutePath: "/r", status: "active" }],
      sessions: [],
      memories: [],
      extractionRuns: [
        {
          id: "run-1",
          sourceSessionId: "session-1",
          assistantMessageId: "message-1",
          trigger: "assistant-completed",
          status: "completed",
          createdCount: 3,
          savedCount: 1,
          candidateCount: 2,
          rejectedCount: 0,
          skippedCount: 1,
          error: null,
          startedAt: 1700000000000,
          completedAt: 1700000001000,
          readAt: null,
        },
      ],
      unreadExtractionCount: 1,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemorySettings />);
    expect(await screen.findByText("新着 1件")).toBeTruthy();
    expect(screen.getByText(/保存 1 \/ 候補 2 \/ 拒否 0/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "すべて既読" }));
    const readCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).includes("/api/memory/extractions/read") && init?.method === "POST",
      );
      expect(call).toBeTruthy();
      return call;
    });
    expect(JSON.parse(String(readCall?.[1]?.body))).toEqual({ workspaceId: "ws-1" });
    await waitFor(() => expect(screen.queryByText("新着 1件")).toBeNull());
  });
});
