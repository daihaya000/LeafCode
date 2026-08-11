import { describe, expect, it } from "vitest";
import { rankModelUsage } from "./model-ranking";
import type { MessageWithParts } from "./types";

function message(
  providerID: string,
  modelID: string,
  output: number,
  cost: number,
): MessageWithParts {
  return {
    info: {
      id: `${providerID}-${modelID}-${output}-${cost}`,
      role: "assistant",
      providerID,
      modelID,
      cost,
      tokens: { input: 0, output, reasoning: 0 },
    },
    parts: [],
  };
}

describe("rankModelUsage", () => {
  it("ranks models by output and reasoning tokens per reported dollar", () => {
    const result = rankModelUsage([
      {
        sessionId: "ses-1",
        messages: [
          message("slow", "model", 100, 1),
          message("fast", "model", 300, 1),
        ],
      },
      {
        sessionId: "ses-2",
        messages: [message("fast", "model", 100, 1)],
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        providerID: "fast",
        modelID: "model",
        sessions: 2,
        turns: 2,
        tokens: 400,
        cost: 2,
        tokensPerDollar: 200,
      }),
      expect.objectContaining({
        providerID: "slow",
        modelID: "model",
        tokensPerDollar: 100,
      }),
    ]);
  });

  it("ignores user and unidentified assistant messages and keeps free models last", () => {
    const free = message("free", "model", 10, 0);
    const unidentified: MessageWithParts = {
      ...free,
      info: { ...free.info, id: "unknown", providerID: undefined },
    };
    const user: MessageWithParts = {
      ...free,
      info: { ...free.info, id: "user", role: "user" },
    };

    const result = rankModelUsage([
      { sessionId: "ses-1", messages: [free, unidentified, user] },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ providerID: "free", tokensPerDollar: null });
  });

  it("uses configured model pricing when OpenCode reports no cost", () => {
    const result = rankModelUsage(
      [{ sessionId: "ses-1", messages: [message("paid", "model", 100, 0)] }],
      { "paid::model": { input: 0, output: 10 } },
    );

    expect(result[0].cost).toBeCloseTo(0.001, 12);
    expect(result[0].tokensPerDollar).toBeCloseTo(100_000, 8);
  });

  it("prefers OpenCode's reported cost over a configured estimate", () => {
    const result = rankModelUsage(
      [{ sessionId: "ses-1", messages: [message("paid", "model", 100, 2)] }],
      { "paid::model": { input: 0, output: 10 } },
    );

    expect(result[0]).toMatchObject({ cost: 2, tokensPerDollar: 50 });
  });
});
