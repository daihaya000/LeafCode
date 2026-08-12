import { describe, expect, it, vi } from "vitest";

// `opencode-paths` imports `isV2ApiGeneration` from `opencode-generation`.
// Mock it to `true` so we can verify every active selector resolves to the v2
// builder (the "flip the flag" path) without changing the committed constant.
vi.mock("./opencode-generation", () => ({
  OPENCODE_API_GENERATION: "v2",
  isV2ApiGeneration: () => true,
}));

import {
  activeCompactPath,
  activeEventPath,
  activeInterruptPath,
  activePermissionListPath,
  activePermissionReplyPath,
  activePromptPath,
  activeQuestionListPath,
  activeQuestionRejectPath,
  activeQuestionReplyPath,
  activeRevertClearPath,
  activeRevertStagePath,
  activeSessionGetPath,
  activeSessionMessagePath,
  sessionCommandPath,
  sessionDiffPath,
  sessionTodoPath,
} from "./opencode-paths";

describe("active generation selectors under v2 flag", () => {
  it("resolves migration-target operations to v2 builders", () => {
    expect(activeSessionGetPath("ses_1")).toBe("/api/session/ses_1");
    expect(activeSessionMessagePath("ses_1")).toBe(
      "/api/session/ses_1/message",
    );
    expect(activePromptPath("ses_1")).toBe("/api/session/ses_1/prompt");
    expect(activeInterruptPath("ses_1")).toBe("/api/session/ses_1/interrupt");
    expect(activeCompactPath("ses_1")).toBe("/api/session/ses_1/compact");
    expect(activeEventPath()).toBe("/api/event");
    expect(activePermissionListPath()).toBe("/api/permission/request");
    expect(activeQuestionListPath()).toBe("/api/question/request");
    expect(activePermissionReplyPath("ses_1", "perm_1")).toBe(
      "/api/session/ses_1/permission/perm_1/reply",
    );
    expect(activeQuestionReplyPath("ses_1", "q_1")).toBe(
      "/api/session/ses_1/question/q_1/reply",
    );
    expect(activeQuestionRejectPath("ses_1", "q_1")).toBe(
      "/api/session/ses_1/question/q_1/reject",
    );
    expect(activeRevertStagePath("ses_1")).toBe(
      "/api/session/ses_1/revert/stage",
    );
    expect(activeRevertClearPath("ses_1")).toBe(
      "/api/session/ses_1/revert/clear",
    );
  });

  it("keeps v1-maintain operations on v1 builders under the v2 flag", () => {
    // todo/diff/command/children have no v2 equivalent and must not be routed
    // through the generation switch at all.
    expect(sessionTodoPath("ses_1")).toBe("/session/ses_1/todo");
    expect(sessionDiffPath("ses_1")).toBe("/session/ses_1/diff");
    expect(sessionCommandPath("ses_1")).toBe("/session/ses_1/command");
  });
});
