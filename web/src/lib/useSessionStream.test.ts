import { describe, expect, it } from "vitest";
import {
  createInitialStreamState,
  sessionStreamReducer,
} from "./useSessionStream";

describe("session stream scope changes", () => {
  it("clears all session-owned state when switching sessions", () => {
    let state = createInitialStreamState("C:/repo\u0000session-a");
    state = sessionStreamReducer(state, {
      kind: "init",
      messages: [
        {
          info: { id: "message-a", role: "user" },
          parts: [],
        },
      ],
    });
    state = sessionStreamReducer(state, {
      kind: "status",
      status: { type: "busy" },
    });
    state = sessionStreamReducer(state, {
      kind: "questionAsked",
      request: {
        id: "question-a",
        version: "v1",
        sessionID: "session-a",
        questions: [],
        receivedAt: 1,
      },
    });

    const reset = sessionStreamReducer(state, {
      kind: "reset",
      scopeKey: "C:/repo\u0000session-b",
    });

    expect(reset.scopeKey).toBe("C:/repo\u0000session-b");
    expect(reset.messages).toEqual([]);
    expect(reset.questions).toEqual([]);
    expect(reset.status).toBeNull();
    expect(reset.loaded).toBe(false);
  });
});
