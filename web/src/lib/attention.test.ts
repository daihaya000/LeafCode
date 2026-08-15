import { describe, expect, it } from "vitest";
import {
  parseGlobalEvent,
  parseGlobalSessionActivity,
  parseGlobalSessionCreated,
  isResolvedEvent,
} from "./attention";
import type { PermissionRequest, QuestionRequest } from "./types";

describe("parseGlobalEvent", () => {
  it("parses a permission event", () => {
    const raw = JSON.stringify({
      type: "permission.asked",
      directory: "/workspace/a",
      properties: {
        id: "p1",
        sessionID: "s1",
        permission: "edit",
        patterns: ["*.ts"],
      },
    });
    const item = parseGlobalEvent(raw);
    expect(item).not.toBeNull();
    expect(item?.kind).toBe("permission");
    const request = item?.request as PermissionRequest;
    expect(request.id).toBe("p1");
    expect(request.sessionID).toBe("s1");
    expect(request.permission).toBe("edit");
  });

  it("parses a question event", () => {
    const raw = JSON.stringify({
      type: "question.v2.asked",
      directory: "/workspace/b",
      properties: {
        id: "q1",
        sessionID: "s2",
        questions: [{ question: "ok?", options: [{ label: "yes", description: "" }] }],
      },
    });
    const item = parseGlobalEvent(raw);
    expect(item).not.toBeNull();
    expect(item?.kind).toBe("question");
    const request = item?.request as QuestionRequest;
    expect(request.id).toBe("q1");
    expect(request.sessionID).toBe("s2");
  });

  it("parses a nested question envelope (real Global event shape)", () => {
    const raw = JSON.stringify({
      directory: "/workspace/c",
      payload: {
        type: "question.asked",
        properties: {
          id: "q9",
          sessionID: "s9",
          questions: [{ question: "ok?", options: [{ label: "yes", description: "" }] }],
        },
      },
    });
    const item = parseGlobalEvent(raw);
    expect(item).not.toBeNull();
    expect(item?.kind).toBe("question");
    expect(item?.directory).toBe("/workspace/c");
    const request = item?.request as QuestionRequest;
    expect(request.id).toBe("q9");
    expect(request.sessionID).toBe("s9");
    expect(request.version).toBe("v1");
  });

  it("parses a nested v2 permission envelope", () => {
    const raw = JSON.stringify({
      directory: "/workspace/d",
      payload: {
        type: "permission.v2.asked",
        properties: { id: "p9", sessionID: "s10", permission: "edit", patterns: ["*.ts"] },
      },
    });
    const item = parseGlobalEvent(raw);
    expect(item?.kind).toBe("permission");
    const request = item?.request as PermissionRequest;
    expect(request.id).toBe("p9");
    expect(request.version).toBe("v2");
  });

  it("ignores irrelevant events", () => {
    expect(parseGlobalEvent(JSON.stringify({ type: "message.updated" }))).toBeNull();
  });

  it("ignores malformed JSON", () => {
    expect(parseGlobalEvent("not json")).toBeNull();
  });
});

describe("isResolvedEvent", () => {
  it("returns requestId+sessionID for permission.replied", () => {
    expect(
      isResolvedEvent(
        JSON.stringify({
          type: "permission.replied",
          properties: { id: "p1", sessionID: "s1" },
        }),
      ),
    ).toEqual({ requestId: "p1", sessionID: "s1" });
  });
  it("returns requestId+sessionID for question.v2.rejected", () => {
    expect(
      isResolvedEvent(
        JSON.stringify({
          type: "question.v2.rejected",
          properties: { requestID: "q1", sessionID: "s1" },
        }),
      ),
    ).toEqual({ requestId: "q1", sessionID: "s1" });
  });
  it("returns null when sessionID is missing", () => {
    expect(
      isResolvedEvent(
        JSON.stringify({ type: "permission.replied", properties: { id: "p1" } }),
      ),
    ).toBeNull();
  });
  it("returns id for a nested question.v2.rejected envelope", () => {
    expect(
      isResolvedEvent(
        JSON.stringify({
          directory: "/workspace/c",
          payload: {
            type: "question.v2.rejected",
            properties: { requestID: "q9", sessionID: "s9" },
          },
        }),
      ),
    ).toEqual({ requestId: "q9", sessionID: "s9" });
  });
  it("returns null for asked", () => {
    expect(isResolvedEvent(JSON.stringify({ type: "permission.asked", properties: { id: "p1" } })))
      .toBeNull();
  });
});

describe("parseGlobalSessionCreated", () => {
  it("parses info.id and info.parentID", () => {
    expect(
      parseGlobalSessionCreated(
        JSON.stringify({
          type: "session.created",
          directory: "/repo",
          properties: { info: { id: "child", parentID: "parent" } },
        }),
      ),
    ).toEqual({ directory: "/repo", sessionID: "child", parentID: "parent" });
  });

  it("parses nested payload envelopes", () => {
    expect(
      parseGlobalSessionCreated(
        JSON.stringify({
          directory: "/repo",
          payload: {
            type: "session.created",
            properties: { info: { id: "c2", parentID: "p2" } },
          },
        }),
      ),
    ).toEqual({ directory: "/repo", sessionID: "c2", parentID: "p2" });
  });

  it("returns null without parentID", () => {
    expect(
      parseGlobalSessionCreated(
        JSON.stringify({
          type: "session.created",
          directory: "/repo",
          properties: { info: { id: "child" } },
        }),
      ),
    ).toBeNull();
  });
});

describe("parseGlobalSessionActivity", () => {
  it("parses session.status busy", () => {
    expect(
      parseGlobalSessionActivity(
        JSON.stringify({
          type: "session.status",
          directory: "/repo",
          properties: { sessionID: "s1", status: { type: "busy" } },
        }),
      ),
    ).toEqual({ sessionID: "s1", type: "busy" });
  });

  it("parses session.idle without a status object", () => {
    expect(
      parseGlobalSessionActivity(
        JSON.stringify({
          type: "session.idle",
          directory: "/repo",
          properties: { sessionID: "s1" },
        }),
      ),
    ).toEqual({ sessionID: "s1", type: "idle" });
  });

  it("parses nested payload envelopes", () => {
    expect(
      parseGlobalSessionActivity(
        JSON.stringify({
          directory: "/repo",
          payload: {
            type: "session.status",
            properties: { sessionID: "s2", status: { type: "retry" } },
          },
        }),
      ),
    ).toEqual({ sessionID: "s2", type: "retry" });
  });

  it("returns null for unrelated events, bad json and unknown status types", () => {
    expect(
      parseGlobalSessionActivity(
        JSON.stringify({
          type: "message.updated",
          properties: { sessionID: "s1" },
        }),
      ),
    ).toBeNull();
    expect(parseGlobalSessionActivity("{not json")).toBeNull();
    expect(
      parseGlobalSessionActivity(
        JSON.stringify({
          type: "session.status",
          properties: { sessionID: "s1", status: { type: "weird" } },
        }),
      ),
    ).toBeNull();
    expect(
      parseGlobalSessionActivity(
        JSON.stringify({
          type: "session.status",
          properties: { status: { type: "busy" } },
        }),
      ),
    ).toBeNull();
  });
});
