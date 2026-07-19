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

function questionItem(directory: string, sessionID: string, id: string): AttentionItem {
  return {
    kind: "question",
    directory,
    request: {
      id,
      version: "v1",
      sessionID,
      questions: [],
      receivedAt: 1,
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

  it("keeps questions matching active scope", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, { kind: "add", item: questionItem("/a", "s1", "q1") });
    state = attentionQueueReducer(state, { kind: "setActiveScope", scope: { directory: "/a", sessionId: "s1" } });
    expect(state.items).toHaveLength(1);
  });

  it("keeps non-matching items when scope changes", () => {
    let state: AttentionQueueState = { items: [], tasks: [] };
    state = attentionQueueReducer(state, { kind: "add", item: permissionItem("/a", "s1", "p1") });
    state = attentionQueueReducer(state, { kind: "setActiveScope", scope: { directory: "/b", sessionId: "s2" } });
    expect(state.items).toHaveLength(1);
  });
});

describe("shouldQueueAttention", () => {
  const activeScope = { directory: "/a", sessionId: "s1" };

  it("queues a question from the active scope", () => {
    expect(shouldQueueAttention(questionItem("/a", "s1", "q1"), activeScope)).toBe(true);
  });

  it("does not queue a permission from the active scope", () => {
    expect(shouldQueueAttention(permissionItem("/a", "s1", "p1"), activeScope)).toBe(false);
  });
});
