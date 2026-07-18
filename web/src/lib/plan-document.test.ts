import { describe, expect, it } from "vitest";
import type { MessageWithParts } from "./types";
import {
  extractPlanMarkdownPath,
  isPlanApproved,
  PLAN_APPROVAL_PROMPT,
} from "./plan-document";

function message(overrides: Partial<MessageWithParts> = {}): MessageWithParts {
  return {
    info: {
      id: "m1",
      role: "assistant",
      agent: "plan",
      time: { completed: 1 },
    },
    parts: [{ id: "p1", messageID: "m1", type: "text", text: "C:\\repo\\plan.md" }],
    ...overrides,
  };
}

describe("extractPlanMarkdownPath", () => {
  it("returns a Windows Markdown path from a completed Plan response", () => {
    expect(extractPlanMarkdownPath(message())).toBe("C:\\repo\\plan.md");
  });

  it("returns a POSIX Markdown path from a completed Plan response", () => {
    expect(extractPlanMarkdownPath(message({
      parts: [{ id: "p1", messageID: "m1", type: "text", text: "/repo/plan.md" }],
    }))).toBe("/repo/plan.md");
  });

  it("strips a surrounding backtick pair", () => {
    expect(extractPlanMarkdownPath(message({
      parts: [{ id: "p1", messageID: "m1", type: "text", text: "`C:\\repo\\plan.md`" }],
    }))).toBe("C:\\repo\\plan.md");
  });

  it("returns a Markdown filename from a Plan file part", () => {
    expect(extractPlanMarkdownPath(message({
      parts: [{ id: "p1", messageID: "m1", type: "file", filename: "/repo/spec.md" }],
    }))).toBe("/repo/spec.md");
  });

  it("returns a Windows UNC Markdown path", () => {
    expect(extractPlanMarkdownPath(message({
      parts: [{ id: "p1", messageID: "m1", type: "text", text: "\\\\server\\share\\repo\\plan.md" }],
    }))).toBe("\\\\server\\share\\repo\\plan.md");
  });

  it("returns a Windows extended-length Markdown path", () => {
    expect(extractPlanMarkdownPath(message({
      parts: [{ id: "p1", messageID: "m1", type: "text", text: "\\\\?\\C:\\repo\\plan.md" }],
    }))).toBe("\\\\?\\C:\\repo\\plan.md");
  });

  it.each([
    { info: { id: "m1", role: "assistant" as const, agent: "build", time: { completed: 1 } } },
    { info: { id: "m1", role: "assistant" as const, agent: "plan", time: {} } },
  ])("rejects non-actionable message metadata", ({ info }) => {
    expect(extractPlanMarkdownPath(message({ info }))).toBeNull();
  });

  it.each([
    "Plan: C:\\repo\\plan.md",
    "C:\\repo\\one.md\nC:\\repo\\two.md",
    "C:\\repo\\plan.txt",
  ])("rejects non-path-only text: %s", (text) => {
    expect(extractPlanMarkdownPath(message({
      parts: [{ id: "p1", messageID: "m1", type: "text", text }],
    }))).toBeNull();
  });
});

function userApproval(id: string, agent?: string, text = PLAN_APPROVAL_PROMPT): MessageWithParts {
  return {
    info: { id, role: "user", ...(agent ? { agent } : {}) },
    parts: [{ id: `${id}-part`, messageID: id, type: "text", text }],
  };
}

describe("isPlanApproved", () => {
  const plan = message({ info: { id: "plan-1", role: "assistant", agent: "plan", time: { completed: 1 } } });

  it("is true when a Build-agent approval prompt follows the Plan", () => {
    const messages = [plan, userApproval("u1", "build")];
    expect(isPlanApproved(messages, "plan-1")).toBe(true);
  });

  it("is true when the approval prompt has no agent metadata", () => {
    const messages = [plan, userApproval("u1")];
    expect(isPlanApproved(messages, "plan-1")).toBe(true);
  });

  it("ignores approval-looking messages that appear before the Plan", () => {
    const messages = [userApproval("u0", "build"), plan];
    expect(isPlanApproved(messages, "plan-1")).toBe(false);
  });

  it("is false without an exact approval prompt after the Plan", () => {
    const messages = [plan, userApproval("u1", "build", "承認します")];
    expect(isPlanApproved(messages, "plan-1")).toBe(false);
  });

  it("is false when the Plan message id is not present", () => {
    expect(isPlanApproved([plan, userApproval("u1")], "missing")).toBe(false);
  });

  it("rejects an exact approval prompt from the Plan agent", () => {
    const messages = [plan, userApproval("u1", "plan")];
    expect(isPlanApproved(messages, "plan-1")).toBe(false);
  });

  it("rejects an exact approval prompt from another agent", () => {
    const messages = [plan, userApproval("u1", "other")];
    expect(isPlanApproved(messages, "plan-1")).toBe(false);
  });

  it("ignores assistant messages that echo the prompt text", () => {
    const echo: MessageWithParts = {
      info: { id: "a1", role: "assistant", agent: "build" },
      parts: [{ id: "a1-part", messageID: "a1", type: "text", text: PLAN_APPROVAL_PROMPT }],
    };
    expect(isPlanApproved([plan, echo], "plan-1")).toBe(false);
  });
});
