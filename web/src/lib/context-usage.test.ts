import { describe, expect, it } from "vitest";
import { computeContextUsage } from "./context-usage";
import type { MessageWithParts } from "./types";
import type { ProviderModelMeta } from "./model-variants";

function assistant(
  overrides: Partial<MessageWithParts["info"]> = {},
): MessageWithParts {
  return {
    info: {
      id: overrides.id ?? "m1",
      role: "assistant",
      providerID: "anthropic",
      modelID: "claude-sonnet-5",
      ...overrides,
    },
    parts: [],
  };
}

function user(id = "u1"): MessageWithParts {
  return { info: { id, role: "user" }, parts: [] };
}

const modelsWithLimit: Record<string, ProviderModelMeta> = {
  "anthropic::claude-sonnet-5": { limit: { context: 200_000 } },
};

describe("computeContextUsage", () => {
  it("returns null when there are no messages", () => {
    expect(computeContextUsage([], modelsWithLimit)).toBeNull();
  });

  it("returns null when no assistant message has token usage yet", () => {
    const messages = [user(), assistant({ tokens: undefined })];
    expect(computeContextUsage(messages, modelsWithLimit)).toBeNull();
  });

  it("returns null when the turn's model has no known context limit", () => {
    const messages = [
      assistant({
        providerID: "unknown",
        modelID: "mystery",
        tokens: { input: 100, output: 50, reasoning: 0 },
      }),
    ];
    expect(computeContextUsage(messages, modelsWithLimit)).toBeNull();
  });

  it("uses tokens.total when present", () => {
    const messages = [
      assistant({
        tokens: { total: 40_000, input: 1, output: 1, reasoning: 1 },
      }),
    ];
    expect(computeContextUsage(messages, modelsWithLimit)).toEqual({
      used: 40_000,
      limit: 200_000,
      pct: 20,
    });
  });

  it("falls back to summing input/output/reasoning/cache when total is absent", () => {
    const messages = [
      assistant({
        tokens: {
          input: 1000,
          output: 500,
          reasoning: 100,
          cache: { read: 300, write: 100 },
        },
      }),
    ];
    // 1000 + 500 + 100 + 300 + 100 = 2000
    expect(computeContextUsage(messages, modelsWithLimit)).toEqual({
      used: 2000,
      limit: 200_000,
      pct: 1,
    });
  });

  it("uses the most recent assistant turn, not an earlier one", () => {
    const messages = [
      assistant({ id: "m1", tokens: { total: 190_000, input: 0, output: 0, reasoning: 0 } }),
      user("u2"),
      assistant({ id: "m3", tokens: { total: 10_000, input: 0, output: 0, reasoning: 0 } }),
    ];
    expect(computeContextUsage(messages, modelsWithLimit)).toEqual({
      used: 10_000,
      limit: 200_000,
      pct: 5,
    });
  });

  it("ignores user messages even if they are last", () => {
    const messages = [
      assistant({ tokens: { total: 50_000, input: 0, output: 0, reasoning: 0 } }),
      user(),
    ];
    expect(computeContextUsage(messages, modelsWithLimit)).toEqual({
      used: 50_000,
      limit: 200_000,
      pct: 25,
    });
  });

  it("caps pct at 100 even if usage exceeds the limit", () => {
    const messages = [
      assistant({
        tokens: { total: 250_000, input: 0, output: 0, reasoning: 0 },
      }),
    ];
    expect(computeContextUsage(messages, modelsWithLimit)).toEqual({
      used: 250_000,
      limit: 200_000,
      pct: 100,
    });
  });

  it("treats a zero or negative context limit as unknown", () => {
    const models: Record<string, ProviderModelMeta> = {
      "anthropic::claude-sonnet-5": { limit: { context: 0 } },
    };
    const messages = [
      assistant({ tokens: { total: 100, input: 0, output: 0, reasoning: 0 } }),
    ];
    expect(computeContextUsage(messages, models)).toBeNull();
  });
});
