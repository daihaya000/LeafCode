import { describe, expect, it } from "vitest";
import { goalLoopTestSeams } from "./goal-loop";
import type { MessageWithParts } from "./types";

function msg(id: string, role: "user" | "assistant", structured?: unknown): MessageWithParts {
  return {
    info: {
      id,
      role,
      structured,
    },
    parts: [],
  };
}

describe("goalLoopTestSeams", () => {
  it("normalizes structured goal progress", () => {
    const result = goalLoopTestSeams.normalizeStructured({
      status: "progress",
      summary: "updated files",
      next: "run tests",
      evidence: "changed src/app.ts",
    });

    expect(result).toMatchObject({
      status: "progress",
      summary: "updated files",
      next: "run tests",
      evidence: "changed src/app.ts",
    });
    expect(result?.time).toEqual(expect.any(String));
  });

  it("rejects malformed structured goal output", () => {
    expect(goalLoopTestSeams.normalizeStructured({ status: "done" })).toBeNull();
    expect(goalLoopTestSeams.normalizeStructured({ status: "progress" })).toBeNull();
    expect(goalLoopTestSeams.normalizeStructured(null)).toBeNull();
  });

  it("finds the next assistant message after the loop boundary", () => {
    const messages = [
      msg("u1", "user"),
      msg("a1", "assistant"),
      msg("u2", "user"),
      msg("a2", "assistant", { status: "completed", summary: "done" }),
    ];

    expect(goalLoopTestSeams.latestMessageId(messages)).toBe("a2");
    expect(goalLoopTestSeams.nextAssistantAfter(messages, "a1")?.info.id).toBe("a2");
    expect(goalLoopTestSeams.nextAssistantAfter(messages, "a2")).toBeNull();
  });

  it("treats a missing lastMessageId as scanning from the start", () => {
    const messages = [msg("u1", "user"), msg("a1", "assistant", { status: "progress", summary: "x" })];
    expect(goalLoopTestSeams.nextAssistantAfter(messages, null)?.info.id).toBe("a1");
  });

  it("skips user messages between the boundary and the next assistant", () => {
    const messages = [
      msg("u1", "user"),
      msg("a1", "assistant", { status: "progress", summary: "step" }),
      msg("u2", "user"),
      msg("u3", "user"),
      msg("a2", "assistant", { status: "progress", summary: "next" }),
    ];
    expect(goalLoopTestSeams.nextAssistantAfter(messages, "a1")?.info.id).toBe("a2");
  });

  it("handles a stale lastMessageId that no longer exists in the snapshot", () => {
    const messages = [msg("a1", "assistant", { status: "progress", summary: "x" })];
    // findIndex returns -1, Math.max(0, -1 + 1) = 0 -> scans from start
    expect(goalLoopTestSeams.nextAssistantAfter(messages, "ghost")?.info.id).toBe("a1");
  });

  it("returns null for an empty message list", () => {
    expect(goalLoopTestSeams.latestMessageId([])).toBeNull();
    expect(goalLoopTestSeams.nextAssistantAfter([], null)).toBeNull();
  });

  it("clamps oversized structured fields to the documented limits", () => {
    const longSummary = "s".repeat(5000);
    const longEvidence = "e".repeat(5000);
    const result = goalLoopTestSeams.normalizeStructured({
      status: "progress",
      summary: longSummary,
      evidence: longEvidence,
      next: "n".repeat(3000),
    });
    expect(result?.summary.length).toBe(4000);
    expect(result?.evidence?.length).toBe(4000);
    expect(result?.next?.length).toBe(2000);
  });

  it("preserves blocked status and routes blockedReason into evidence when evidence is absent", () => {
    const result = goalLoopTestSeams.normalizeStructured({
      status: "blocked",
      summary: "need input",
      blockedReason: "awaiting approval",
    });
    expect(result?.status).toBe("blocked");
    expect(result?.evidence).toBe("awaiting approval");
  });
});
