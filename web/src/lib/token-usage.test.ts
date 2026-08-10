import { describe, it, expect } from "vitest";
import {
  cumulativeTokenUsage,
  lastTurnTokenUsage,
} from "./token-usage";
import type { MessageWithParts } from "./types";

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

describe("lastTurnTokenUsage", () => {
  it("returns null when there are no messages", () => {
    expect(lastTurnTokenUsage([])).toBeNull();
  });

  it("returns null when no assistant message has token usage", () => {
    const messages = [user(), assistant({ tokens: undefined })];
    expect(lastTurnTokenUsage(messages)).toBeNull();
  });

  it("uses the most recent assistant turn, not an earlier one", () => {
    const messages = [
      assistant({
        id: "m1",
        tokens: {
          input: 10_000,
          output: 500,
          reasoning: 100,
          cache: { read: 2000, write: 300 },
          total: 12_900,
        },
      }),
      user("u2"),
      assistant({
        id: "m3",
        tokens: {
          input: 5_000,
          output: 300,
          reasoning: 50,
          cache: { read: 4000, write: 100 },
          total: 9_450,
        },
      }),
    ];
    const usage = lastTurnTokenUsage(messages);
    expect(usage).not.toBeNull();
    expect(usage!.input).toBe(5_000);
    expect(usage!.cacheRead).toBe(4_000);
    expect(usage!.cacheWrite).toBe(100);
    expect(usage!.output).toBe(300);
    expect(usage!.reasoning).toBe(50);
    expect(usage!.total).toBe(9_450);
    // cacheHitPct = 4000 / (5000 + 4000) = 44%
    expect(usage!.cacheHitPct).toBe(44);
  });

  it("falls back to summing fields when total is absent", () => {
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
    const usage = lastTurnTokenUsage(messages);
    expect(usage).not.toBeNull();
    // total = 1000 + 500 + 100 + 300 + 100 = 2000
    expect(usage!.total).toBe(2_000);
  });

  it("skips a trailing assistant record with zero token usage", () => {
    const messages = [
      assistant({
        id: "m1",
        tokens: {
          input: 8_000,
          output: 1_000,
          reasoning: 1_000,
          total: 10_000,
        },
      }),
      assistant({
        id: "m2",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }),
    ];
    const usage = lastTurnTokenUsage(messages);
    expect(usage).not.toBeNull();
    expect(usage!.input).toBe(8_000);
    expect(usage!.total).toBe(10_000);
  });

  it("reports 0 cache hit when no cache read or input tokens", () => {
    const messages = [
      assistant({
        tokens: {
          input: 0,
          output: 100,
          reasoning: 0,
          cache: { read: 0, write: 0 },
          total: 100,
        },
      }),
    ];
    const usage = lastTurnTokenUsage(messages);
    expect(usage).not.toBeNull();
    expect(usage!.cacheHitPct).toBe(0);
  });

  it("ignores user messages even if they are last", () => {
    const messages = [
      assistant({ tokens: { input: 100, output: 50, reasoning: 0, total: 150 } }),
      user("u2"),
    ];
    const usage = lastTurnTokenUsage(messages);
    expect(usage).not.toBeNull();
    expect(usage!.input).toBe(100);
  });

  it("clamps negative values to zero", () => {
    const messages = [
      assistant({
        tokens: {
          input: -10,
          output: -5,
          reasoning: -1,
          cache: { read: -2, write: -3 },
          total: -100,
        },
      }),
    ];
    const usage = lastTurnTokenUsage(messages);
    expect(usage).not.toBeNull();
    expect(usage!.input).toBe(0);
    expect(usage!.output).toBe(0);
    expect(usage!.reasoning).toBe(0);
    expect(usage!.cacheRead).toBe(0);
    expect(usage!.cacheWrite).toBe(0);
    expect(usage!.total).toBe(0);
  });
});

describe("cumulativeTokenUsage", () => {
  it("returns all-zero for empty messages", () => {
    const usage = cumulativeTokenUsage([]);
    expect(usage.input).toBe(0);
    expect(usage.output).toBe(0);
    expect(usage.total).toBe(0);
    expect(usage.cacheHitPct).toBe(0);
  });

  it("sums across all assistant turns", () => {
    const messages = [
      assistant({
        id: "a1",
        tokens: {
          input: 1_000,
          output: 200,
          reasoning: 50,
          cache: { read: 500, write: 100 },
          total: 1_850,
        },
      }),
      assistant({
        id: "a2",
        tokens: {
          input: 2_000,
          output: 300,
          reasoning: 100,
          cache: { read: 1_000, write: 200 },
          total: 3_600,
        },
      }),
    ];
    const usage = cumulativeTokenUsage(messages);
    expect(usage.input).toBe(3_000);
    expect(usage.output).toBe(500);
    expect(usage.reasoning).toBe(150);
    expect(usage.cacheRead).toBe(1_500);
    expect(usage.cacheWrite).toBe(300);
    expect(usage.total).toBe(5_450);
    // cacheHitPct = 1500 / (3000 + 1500) = 33%
    expect(usage.cacheHitPct).toBe(33);
  });

  it("skips user messages", () => {
    const messages = [
      user("u1"),
      assistant({
        tokens: { input: 500, output: 100, reasoning: 0, total: 600 },
      }),
      user("u2"),
    ];
    const usage = cumulativeTokenUsage(messages);
    expect(usage.input).toBe(500);
    expect(usage.output).toBe(100);
    expect(usage.total).toBe(600);
  });

  it("handles assistant messages with undefined tokens", () => {
    const messages = [
      assistant({ tokens: undefined }),
      assistant({
        tokens: { input: 500, output: 100, reasoning: 0, total: 600 },
      }),
    ];
    const usage = cumulativeTokenUsage(messages);
    expect(usage.input).toBe(500);
    expect(usage.output).toBe(100);
  });

  it("falls back to zero total when not reported", () => {
    const messages = [
      assistant({
        tokens: {
          input: 100,
          output: 50,
          reasoning: 10,
          cache: { read: 30, write: 10 },
        },
      }),
    ];
    const usage = cumulativeTokenUsage(messages);
    // total not reported → stays 0 in cumulative (unlike lastTurn which sums)
    expect(usage.total).toBe(0);
    expect(usage.input).toBe(100);
  });
});