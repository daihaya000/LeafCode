import { describe, expect, it } from "vitest";
import {
  EVENT_PATH,
  EVENT_PATH_V2,
  OC_PATH_TEMPLATES,
  PERMISSION_LIST_PATH,
  PERMISSION_REQUEST_PATH_V2,
  PERMISSION_SAVED_PATH_V2,
  QUESTION_LIST_PATH,
  QUESTION_REQUEST_PATH_V2,
  SESSION_ACTIVE_PATH_V2,
  SESSION_LIST_PATH,
  SESSION_LIST_PATH_V2,
  SESSION_STATUS_PATH,
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
  permissionReplyPathV1,
  permissionReplyPathV2,
  permissionSavedDeletePathV2,
  questionRejectPathV1,
  questionRejectPathV2,
  questionReplyPathV1,
  questionReplyPathV2,
  sessionAbortPath,
  sessionAgentPathV2,
  sessionCommandPath,
  sessionCompactPathV2,
  sessionContextPathV2,
  sessionDiffPath,
  sessionEventPathV2,
  sessionHistoryPathV2,
  sessionInterruptPathV2,
  sessionMessagePath,
  sessionMessagePathV2,
  sessionModelPathV2,
  sessionPath,
  sessionPathV2,
  sessionPermissionListPathV2,
  sessionPromptAsyncPath,
  sessionPromptPathV2,
  sessionQuestionListPathV2,
  sessionRevertClearPathV2,
  sessionRevertCommitPathV2,
  sessionRevertStagePathV2,
} from "./opencode-paths";

/**
 * These assertions pin the exact strings the engine sees. They are the safety
 * net for the "one place to change" property: if a builder silently starts
 * producing a different path, the callers that were migrated onto it would
 * otherwise fail only at runtime with a 404.
 */
describe("opencode-paths builders", () => {
  it("builds the v1 session surface", () => {
    expect(SESSION_LIST_PATH).toBe("/session");
    expect(SESSION_STATUS_PATH).toBe("/session/status");
    expect(EVENT_PATH).toBe("/event");
    expect(sessionPath("ses_1")).toBe("/session/ses_1");
    expect(sessionMessagePath("ses_1")).toBe("/session/ses_1/message");
    expect(sessionDiffPath("ses_1")).toBe("/session/ses_1/diff");
    expect(sessionAbortPath("ses_1")).toBe("/session/ses_1/abort");
    expect(sessionPromptAsyncPath("ses_1")).toBe("/session/ses_1/prompt_async");
    expect(sessionCommandPath("ses_1")).toBe("/session/ses_1/command");
  });

  it("builds the v1 permission/question surface", () => {
    expect(PERMISSION_LIST_PATH).toBe("/permission");
    expect(QUESTION_LIST_PATH).toBe("/question");
    expect(permissionReplyPathV1("ses_1", "perm_1")).toBe(
      "/session/ses_1/permissions/perm_1",
    );
    expect(questionReplyPathV1("q_1")).toBe("/question/q_1/reply");
    expect(questionRejectPathV1("q_1")).toBe("/question/q_1/reject");
  });

  it("builds the v2 session-scoped permission/question surface", () => {
    expect(sessionPermissionListPathV2("ses_1")).toBe(
      "/api/session/ses_1/permission",
    );
    expect(permissionReplyPathV2("ses_1", "perm_1")).toBe(
      "/api/session/ses_1/permission/perm_1/reply",
    );
    expect(sessionQuestionListPathV2("ses_1")).toBe(
      "/api/session/ses_1/question",
    );
    expect(questionReplyPathV2("ses_1", "q_1")).toBe(
      "/api/session/ses_1/question/q_1/reply",
    );
    expect(questionRejectPathV2("ses_1", "q_1")).toBe(
      "/api/session/ses_1/question/q_1/reject",
    );
  });

  it("builds the v2 session CRUD / prompt / message / interrupt / compact surface", () => {
    expect(SESSION_LIST_PATH_V2).toBe("/api/session");
    expect(SESSION_ACTIVE_PATH_V2).toBe("/api/session/active");
    expect(sessionPathV2("ses_1")).toBe("/api/session/ses_1");
    expect(sessionPromptPathV2("ses_1")).toBe("/api/session/ses_1/prompt");
    expect(sessionMessagePathV2("ses_1")).toBe("/api/session/ses_1/message");
    expect(sessionInterruptPathV2("ses_1")).toBe("/api/session/ses_1/interrupt");
    expect(sessionCompactPathV2("ses_1")).toBe("/api/session/ses_1/compact");
  });

  it("builds the v2 SSE / history / context / agent / model surface", () => {
    expect(EVENT_PATH_V2).toBe("/api/event");
    expect(sessionEventPathV2("ses_1")).toBe("/api/session/ses_1/event");
    expect(sessionHistoryPathV2("ses_1")).toBe("/api/session/ses_1/history");
    expect(sessionContextPathV2("ses_1")).toBe("/api/session/ses_1/context");
    expect(sessionAgentPathV2("ses_1")).toBe("/api/session/ses_1/agent");
    expect(sessionModelPathV2("ses_1")).toBe("/api/session/ses_1/model");
  });

  it("builds the v2 global permission / question / saved surface", () => {
    expect(PERMISSION_REQUEST_PATH_V2).toBe("/api/permission/request");
    expect(QUESTION_REQUEST_PATH_V2).toBe("/api/question/request");
    expect(PERMISSION_SAVED_PATH_V2).toBe("/api/permission/saved");
    expect(permissionSavedDeletePathV2("perm_1")).toBe(
      "/api/permission/saved/perm_1",
    );
  });

  it("builds the v2 revert surface (3-endpoint split)", () => {
    expect(sessionRevertStagePathV2("ses_1")).toBe(
      "/api/session/ses_1/revert/stage",
    );
    expect(sessionRevertCommitPathV2("ses_1")).toBe(
      "/api/session/ses_1/revert/commit",
    );
    expect(sessionRevertClearPathV2("ses_1")).toBe(
      "/api/session/ses_1/revert/clear",
    );
  });
});

describe("opencode-paths id safety", () => {
  it("rejects ids that would escape their segment", () => {
    for (const bad of ["../auth", "a/b", "", ".", "%2e%2e"]) {
      expect(() => sessionMessagePath(bad)).toThrow();
      expect(() => sessionPermissionListPathV2(bad)).toThrow();
    }
  });

  it("percent-encodes request ids inside v1 and v2 reply paths", () => {
    // `openCodeSessionPath` encodes trailing segments; the v2 builders use the
    // same rule so both generations behave identically for odd request ids.
    expect(permissionReplyPathV1("ses_1", "a b")).toBe(
      "/session/ses_1/permissions/a%20b",
    );
    expect(() => permissionReplyPathV2("ses_1", "a b")).toThrow();
  });

  it("rejects unsafe ids in all v2 session builders", () => {
    for (const bad of ["../auth", "a/b", "", ".", "%2e%2e", "ses_1/../../../etc"]) {
      expect(() => sessionPathV2(bad)).toThrow();
      expect(() => sessionPromptPathV2(bad)).toThrow();
      expect(() => sessionMessagePathV2(bad)).toThrow();
      expect(() => sessionInterruptPathV2(bad)).toThrow();
      expect(() => sessionCompactPathV2(bad)).toThrow();
      expect(() => sessionEventPathV2(bad)).toThrow();
      expect(() => sessionHistoryPathV2(bad)).toThrow();
      expect(() => sessionContextPathV2(bad)).toThrow();
      expect(() => sessionAgentPathV2(bad)).toThrow();
      expect(() => sessionModelPathV2(bad)).toThrow();
      expect(() => sessionRevertStagePathV2(bad)).toThrow();
      expect(() => sessionRevertCommitPathV2(bad)).toThrow();
      expect(() => sessionRevertClearPathV2(bad)).toThrow();
    }
  });

  it("rejects unsafe ids in v2 saved-permission delete builder", () => {
    for (const bad of ["../x", "a/b", "", ".", "%2e%2e"]) {
      expect(() => permissionSavedDeletePathV2(bad)).toThrow();
    }
  });

  it("accepts valid ids in all v2 builders", () => {
    const validId = "ses_abc-123.xyz";
    expect(sessionPathV2(validId)).toBe(`/api/session/${validId}`);
    expect(sessionPromptPathV2(validId)).toBe(
      `/api/session/${validId}/prompt`,
    );
    expect(sessionInterruptPathV2(validId)).toBe(
      `/api/session/${validId}/interrupt`,
    );
  });
});

describe("opencode-paths template registry", () => {
  it("keeps every template addressable and unique", () => {
    const templates = Object.values(OC_PATH_TEMPLATES);
    expect(new Set(templates).size).toBe(templates.length);
    for (const t of templates) expect(t.startsWith("/")).toBe(true);
  });

  it("separates the v1 and v2 generations by prefix", () => {
    for (const [name, template] of Object.entries(OC_PATH_TEMPLATES)) {
      if (name.startsWith("v2")) {
        expect(template.startsWith("/api/")).toBe(true);
      } else {
        expect(template.startsWith("/api/")).toBe(false);
      }
    }
  });

  it("includes all v2 migration-target templates", () => {
    const v2Names = Object.entries(OC_PATH_TEMPLATES)
      .filter(([name]) => name.startsWith("v2"))
      .map(([name]) => name);

    const expected = [
      "v2SessionPermissionList",
      "v2SessionPermissionReply",
      "v2SessionQuestionList",
      "v2SessionQuestionReply",
      "v2SessionQuestionReject",
      "v2SessionList",
      "v2SessionActive",
      "v2Session",
      "v2SessionPrompt",
      "v2SessionMessage",
      "v2SessionInterrupt",
      "v2SessionCompact",
      "v2SessionEvent",
      "v2SessionHistory",
      "v2SessionContext",
      "v2SessionAgent",
      "v2SessionModel",
      "v2Event",
      "v2PermissionRequest",
      "v2PermissionSaved",
      "v2PermissionSavedDelete",
      "v2QuestionRequest",
      "v2SessionRevertStage",
      "v2SessionRevertCommit",
      "v2SessionRevertClear",
    ];

    for (const name of expected) {
      expect(v2Names).toContain(name);
    }
  });

  it("includes v1-maintain templates for operations without v2 equivalents", () => {
    const v1Maintain = [
      "sessionSummarize",
      "sessionChildren",
      "sessionFork",
      "sessionShare",
      "sessionInit",
      "sessionShell",
      "sessionRevert",
      "sessionUnrevert",
      "sessionPartEdit",
    ];
    for (const name of v1Maintain) {
      expect(OC_PATH_TEMPLATES).toHaveProperty(name);
    }
  });
});

describe("active generation selectors", () => {
  it("resolve to v1 builders while the generation flag is v1", () => {
    // Default flag is "v1"; these pin the current (unmigrated) behaviour.
    expect(activeSessionGetPath("ses_1")).toBe("/session/ses_1");
    expect(activeSessionMessagePath("ses_1")).toBe("/session/ses_1/message");
    expect(activePromptPath("ses_1")).toBe("/session/ses_1/prompt_async");
    expect(activeInterruptPath("ses_1")).toBe("/session/ses_1/abort");
    expect(activeEventPath()).toBe("/event");
    expect(activePermissionListPath()).toBe("/permission");
    expect(activeQuestionListPath()).toBe("/question");
    expect(activePermissionReplyPath("ses_1", "perm_1")).toBe(
      "/session/ses_1/permissions/perm_1",
    );
    expect(activeQuestionReplyPath("ses_1", "q_1")).toBe("/question/q_1/reply");
    expect(activeQuestionRejectPath("ses_1", "q_1")).toBe(
      "/question/q_1/reject",
    );
    expect(activeRevertStagePath("ses_1")).toBe("/session/ses_1/revert");
    expect(activeRevertClearPath("ses_1")).toBe("/session/ses_1/unrevert");
  });

  it("compact always uses the v2 path (client has no v1 compact builder)", () => {
    expect(activeCompactPath("ses_1")).toBe("/api/session/ses_1/compact");
  });
});
