import { describe, expect, it } from "vitest";
import {
  assistantText,
  extractGoalResult,
  isUnknownPromptDeliveryPause,
  jsonObjectCandidates,
  normalizeStructured,
} from "./goal-state";
import type { MessageWithParts } from "./types";

function assistant(text: string, structured?: unknown): MessageWithParts {
  return {
    info: {
      role: "assistant",
      id: "a1",
      time: { created: 0, completed: 1 },
      ...(structured !== undefined ? { structured } : {}),
    },
    parts: [{ type: "text", text }],
  } as MessageWithParts;
}

function user(text: string): MessageWithParts {
  return {
    info: { role: "user", id: "u1", time: { created: 0 } },
    parts: [{ type: "text", text }],
  } as MessageWithParts;
}

describe("normalizeStructured", () => {
  it("normalizes a valid structured result", () => {
    const result = normalizeStructured({
      status: "completed",
      summary: "  done  ",
      evidence: "tests pass",
      next: "",
    });
    expect(result).toMatchObject({
      status: "completed",
      summary: "done",
      evidence: "tests pass",
    });
    expect(typeof result?.time).toBe("string");
  });

  it("rejects unknown status, arrays, and empty summary", () => {
    expect(normalizeStructured({ status: "nope", summary: "x" })).toBeNull();
    expect(normalizeStructured([{ status: "progress", summary: "x" }])).toBeNull();
    expect(normalizeStructured({ status: "progress", summary: "  " })).toBeNull();
    expect(normalizeStructured(null)).toBeNull();
    expect(normalizeStructured("text")).toBeNull();
  });

  it("maps blockedReason into evidence", () => {
    const result = normalizeStructured({
      status: "blocked",
      summary: "blocked on x",
      blockedReason: "missing key",
    });
    expect(result?.evidence).toBe("missing key");
  });
});

describe("jsonObjectCandidates", () => {
  it("extracts top-level objects ignoring braces inside strings", () => {
    const text = 'pre {"a": 1, "b": "{nested}"} post {"c": 2}';
    expect(jsonObjectCandidates(text)).toEqual([
      '{"a": 1, "b": "{nested}"}',
      '{"c": 2}',
    ]);
  });

  it("returns an empty list without objects", () => {
    expect(jsonObjectCandidates("plain text")).toEqual([]);
    expect(jsonObjectCandidates("")).toEqual([]);
  });
});

describe("assistantText", () => {
  it("joins text parts with newlines", () => {
    const message = {
      ...assistant("first"),
      parts: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
        { type: "file", url: "x" },
      ],
    } as MessageWithParts;
    expect(assistantText(message)).toBe("first\nsecond");
  });
});

describe("extractGoalResult", () => {
  it("prefers info.structured", () => {
    const message = assistant("plain prose", {
      status: "progress",
      summary: "from structured",
    });
    expect(extractGoalResult(message)?.summary).toBe("from structured");
  });

  it("falls back to the last fenced JSON block", () => {
    const message = assistant(
      'some text\n```json\n{"status":"completed","summary":"from json block"}\n```',
    );
    expect(extractGoalResult(message)).toMatchObject({
      status: "completed",
      summary: "from json block",
    });
  });

  it("returns null for prose without a result", () => {
    expect(extractGoalResult(assistant("just prose"))).toBeNull();
  });
});

describe("isUnknownPromptDeliveryPause", () => {
  it("is true only for paused + unknown_delivery", () => {
    expect(
      isUnknownPromptDeliveryPause({
        status: "paused",
        pauseReason: "unknown_delivery",
      } as unknown as Parameters<typeof isUnknownPromptDeliveryPause>[0]),
    ).toBe(true);
    expect(
      isUnknownPromptDeliveryPause({
        status: "paused",
        pauseReason: "other",
      } as unknown as Parameters<typeof isUnknownPromptDeliveryPause>[0]),
    ).toBe(false);
    expect(
      isUnknownPromptDeliveryPause({
        status: "running",
        pauseReason: undefined,
      } as unknown as Parameters<typeof isUnknownPromptDeliveryPause>[0]),
    ).toBe(false);
  });
});
