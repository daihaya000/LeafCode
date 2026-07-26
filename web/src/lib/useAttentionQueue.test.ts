import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  attentionQueueReducer,
  resolveAttentionSessionTitle,
  shouldQueueAttention,
  useAttentionQueue,
  type AttentionQueueState,
} from "./useAttentionQueue";
import type { AttentionItem } from "./attention";
import type { TaskSummary } from "./types";

vi.mock("./client", () => ({
  getJson: vi.fn().mockResolvedValue({ tasks: [] }),
}));

function permissionItem(directory: string, sessionID: string, id: string): AttentionItem {
  return {
    kind: "permission",
    directory,
    request: {
      id,
      version: "v1",
      sessionID,
      permission: "write",
      patterns: [],
      receivedAt: 1,
    },
  };
}

function questionItem(
  directory: string,
  sessionID: string,
  id: string,
  receivedAt = 1,
): AttentionItem {
  return {
    kind: "question",
    directory,
    request: {
      id,
      version: "v1",
      sessionID,
      questions: [],
      receivedAt,
    },
  };
}

describe("attentionQueueReducer", () => {
  it("adds items", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    const item = permissionItem("/a", "s1", "p1");
    state = attentionQueueReducer(state, { kind: "add", item });
    expect(state.items).toHaveLength(1);
  });

  it("removes permissions matching active scope", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, { kind: "add", item: permissionItem("/a", "s1", "p1") });
    state = attentionQueueReducer(state, { kind: "setActiveScope", scope: { directory: "/a", sessionId: "s1" } });
    expect(state.items).toHaveLength(0);
  });

  it("removes questions matching active scope", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, { kind: "add", item: questionItem("/a", "s1", "q1") });
    state = attentionQueueReducer(state, { kind: "setActiveScope", scope: { directory: "/a", sessionId: "s1" } });
    expect(state.items).toHaveLength(0);
  });

  it("keeps non-matching items when scope changes", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, { kind: "add", item: permissionItem("/a", "s1", "p1") });
    state = attentionQueueReducer(state, { kind: "setActiveScope", scope: { directory: "/b", sessionId: "s2" } });
    expect(state.items).toHaveLength(1);
  });

  it("replaces target-directory questions with the sync result", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, { kind: "add", item: questionItem("/a", "s1", "q1", 1) });
    state = attentionQueueReducer(state, {
      kind: "reconcileDirectory",
      directory: "/a",
      questions: [questionItem("/a", "s1", "q2", 50)],
      syncStartedAt: 10,
    });
    expect(state.items.map((i) => i.request.id)).toEqual(["q2"]);
  });

  it("keeps items in other directories during reconcile", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, { kind: "add", item: questionItem("/a", "s1", "q1", 1) });
    state = attentionQueueReducer(state, { kind: "add", item: questionItem("/b", "s2", "q2", 1) });
    state = attentionQueueReducer(state, {
      kind: "reconcileDirectory",
      directory: "/a",
      questions: [],
      syncStartedAt: 10,
    });
    expect(state.items.map((i) => i.request.id)).toEqual(["q2"]);
  });

  it("keeps questions added after sync started", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, { kind: "add", item: questionItem("/a", "s1", "q1", 20) });
    state = attentionQueueReducer(state, {
      kind: "reconcileDirectory",
      directory: "/a",
      questions: [],
      syncStartedAt: 10,
    });
    expect(state.items.map((i) => i.request.id)).toEqual(["q1"]);
  });

  it("does not duplicate a question already present during reconcile", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, { kind: "add", item: questionItem("/a", "s1", "q1", 1) });
    state = attentionQueueReducer(state, {
      kind: "reconcileDirectory",
      directory: "/a",
      questions: [questionItem("/a", "s1", "q1", 99)],
      syncStartedAt: 10,
    });
    expect(state.items).toHaveLength(1);
    // Sync copy wins (parity with useSessionStream permissionsSynced).
    expect(state.items[0]?.request.receivedAt).toBe(99);
  });

  it("keeps pending items for sessions whose v2 fetch failed", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, {
      kind: "add",
      item: permissionItem("/a", "s-fail", "p-local"),
    });
    state = attentionQueueReducer(state, {
      kind: "reconcileDirectory",
      directory: "/a",
      questions: undefined,
      permissions: [permissionItem("/a", "s-ok", "p-remote")],
      syncStartedAt: 10,
      keepPermissionSessionIds: ["s-fail"],
    });
    expect(state.items.map((i) => i.request.id).sort()).toEqual([
      "p-local",
      "p-remote",
    ]);
  });

  it("keeps permissions in the target directory during reconcile", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, { kind: "add", item: permissionItem("/a", "s1", "p1") });
    state = attentionQueueReducer(state, {
      kind: "reconcileDirectory",
      directory: "/a",
      questions: [],
      syncStartedAt: 10,
    });
    expect(state.items.map((i) => i.request.id)).toEqual(["p1"]);
  });
  it("does not re-queue active-scope items during reconcile", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, {
      kind: "reconcileDirectory",
      directory: "/a",
      questions: [questionItem("/a", "s1", "q1", 50)],
      permissions: [permissionItem("/a", "s1", "p1")],
      syncStartedAt: 10,
      activeScope: { directory: "/a", sessionId: "s1" },
    });
    expect(state.items).toEqual([]);
  });
});

describe("attention busy stickiness and 404 replied handling", () => {
  it("does not re-add an item that was recently replied (404 treated as replied)", () => {
    const { result } = renderHook(() => useAttentionQueue(null));
    const item = questionItem("/a", "s1", "q-replied");

    act(() => result.current.add(item));
    expect(result.current.items).toHaveLength(1);

    // Simulate a reply that returned 404: the queue removal still records the id.
    act(() => {
      result.current.remove(item.request.id, item.request.sessionID);
      result.current.add(item);
    });

    expect(result.current.items).toHaveLength(0);
  });

  it("keeps a permission in queue when sync fails (busy does not stick)", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    const item = permissionItem("/a", "s1", "p1");
    state = attentionQueueReducer(state, { kind: "add", item });
    // Partial sync (questions only, permissions undefined) must not drop the permission.
    state = attentionQueueReducer(state, {
      kind: "reconcileDirectory",
      directory: "/a",
      questions: [],
      syncStartedAt: 10,
    });
    expect(state.items.map((i) => i.request.id)).toEqual(["p1"]);
  });

  it("busy does not stick: remove + reconcile does not re-queue the removed item", () => {
    const { result } = renderHook(() => useAttentionQueue(null));
    const item = questionItem("/a", "s1", "q-busy");

    act(() => result.current.add(item));
    expect(result.current.items).toHaveLength(1);

    // Simulate AttentionQueueModal.respond finally: remove then reconcile.
    act(() => result.current.remove(item.request.id, item.request.sessionID));
    act(() => {
      result.current.reconcileDirectory(
        "/a",
        [questionItem("/a", "s1", item.request.id, 50)],
        10,
      );
    });

    expect(result.current.items.map((i) => i.request.id)).not.toContain("q-busy");
  });

  it("does not treat a 404-removed question as still pending after sync", () => {
    const { result } = renderHook(() => useAttentionQueue(null));
    const item = questionItem("/a", "s1", "q-404");

    act(() => result.current.add(item));
    act(() => result.current.remove(item.request.id, item.request.sessionID));
    act(() => {
      result.current.reconcileDirectory(
        "/a",
        [questionItem("/a", "s1", item.request.id, 50)],
        10,
      );
    });

    expect(result.current.items.map((i) => i.request.id)).not.toContain("q-404");
  });
});

describe("shouldQueueAttention", () => {
  const activeScope = { directory: "/a", sessionId: "s1" };

  it("does not queue a question from the active scope", () => {
    expect(shouldQueueAttention(questionItem("/a", "s1", "q1"), activeScope)).toBe(false);
  });

  it("queues a question from another session", () => {
    expect(shouldQueueAttention(questionItem("/a", "s2", "q1"), activeScope)).toBe(true);
  });

  it("does not queue a permission from the active scope", () => {
    expect(shouldQueueAttention(permissionItem("/a", "s1", "p1"), activeScope)).toBe(false);
  });
});

function task(partial: Partial<TaskSummary> & Pick<TaskSummary, "directory" | "sessionId" | "title">): TaskSummary {
  return {
    id: "ws1",
    projectId: "p1",
    projectName: "Proj",
    isolation: "git_worktree",
    status: "idle",
    branch: null,
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("resolveAttentionSessionTitle", () => {
  const item = questionItem("/repo", "ses_1", "q1");

  it("prefers directory + sessionId exact match", () => {
    const tasks = [
      task({ directory: "/other", sessionId: "ses_1", title: "他" }),
      task({ directory: "/repo", sessionId: "ses_1", title: "対象セッション" }),
    ];
    expect(resolveAttentionSessionTitle(item, tasks)).toBe("対象セッション");
  });

  it("falls back to sessionId-only match", () => {
    const tasks = [task({ directory: "/other", sessionId: "ses_1", title: "別ディレクトリ" })];
    expect(resolveAttentionSessionTitle(item, tasks)).toBe("別ディレクトリ");
  });

  it("returns null when no task matches", () => {
    const tasks = [task({ directory: "/repo", sessionId: "ses_other", title: "別" })];
    expect(resolveAttentionSessionTitle(item, tasks)).toBeNull();
  });

  it("ignores blank titles", () => {
    const tasks = [task({ directory: "/repo", sessionId: "ses_1", title: "   " })];
    expect(resolveAttentionSessionTitle(item, tasks)).toBeNull();
  });
});
