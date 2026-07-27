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
});
