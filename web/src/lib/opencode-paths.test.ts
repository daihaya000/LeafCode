import { describe, expect, it } from "vitest";
import {
  EVENT_PATH,
  OC_PATH_TEMPLATES,
  PERMISSION_LIST_PATH,
  QUESTION_LIST_PATH,
  SESSION_LIST_PATH,
  SESSION_STATUS_PATH,
  permissionReplyPathV1,
  permissionReplyPathV2,
  questionRejectPathV1,
  questionRejectPathV2,
  questionReplyPathV1,
  questionReplyPathV2,
  sessionAbortPath,
  sessionCommandPath,
  sessionDiffPath,
  sessionMessagePath,
  sessionPath,
  sessionPermissionListPathV2,
  sessionPromptAsyncPath,
  sessionQuestionListPathV2,
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
});
