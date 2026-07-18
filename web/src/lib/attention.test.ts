import { describe, expect, it } from "vitest";
import { parseGlobalEvent, isResolvedEvent } from "./attention";
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

  it("ignores irrelevant events", () => {
    expect(parseGlobalEvent(JSON.stringify({ type: "message.updated" }))).toBeNull();
  });

  it("ignores malformed JSON", () => {
    expect(parseGlobalEvent("not json")).toBeNull();
  });
});

describe("isResolvedEvent", () => {
  it("returns id for permission.replied", () => {
    expect(isResolvedEvent(JSON.stringify({ type: "permission.replied", properties: { id: "p1" } })))
      .toBe("p1");
  });
  it("returns id for question.v2.rejected", () => {
    expect(isResolvedEvent(JSON.stringify({ type: "question.v2.rejected", properties: { requestID: "q1" } })))
      .toBe("q1");
  });
  it("returns null for asked", () => {
    expect(isResolvedEvent(JSON.stringify({ type: "permission.asked", properties: { id: "p1" } })))
      .toBeNull();
  });
});
