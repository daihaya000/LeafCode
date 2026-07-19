import { describe, expect, it } from "vitest";
import {
  attentionQueueReducer,
  shouldQueueAttention,
  type AttentionQueueState,
} from "./useAttentionQueue";
import type { AttentionItem } from "./attention";

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

  it("does not duplicate by id", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    const item = permissionItem("/a", "s1", "p1");
    state = attentionQueueReducer(state, { kind: "add", item });
    state = attentionQueueReducer(state, { kind: "add", item });
    expect(state.items).toHaveLength(1);
  });

  it("removes by id", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    const item = permissionItem("/a", "s1", "p1");
    state = attentionQueueReducer(state, { kind: "add", item });
    state = attentionQueueReducer(state, { kind: "remove", requestId: "p1" });
    expect(state.items).toHaveLength(0);
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
