import { describe, expect, it } from "vitest";
import type { MessageWithParts } from "./types";
import { extractPlanMarkdownPath } from "./plan-document";

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
