import { beforeEach, describe, expect, it } from "vitest";
import {
  assistantTurnCost,
  costBreakdownByModel,
  costBreakdownLines,
} from "./cost-breakdown";
import { setModelPricingRegistry } from "./model-pricing-registry";
import type { MessageInfo, MessageWithParts } from "./types";

function message(info: Partial<MessageInfo>): MessageWithParts {
  return {
    info: {
      id: info.id ?? "m1",
      role: info.role ?? "assistant",
      ...info,
    } as MessageInfo,
    parts: [],
  };
}

const usd = (cost: number) => `$${cost.toFixed(4)}`;

beforeEach(() => {
  setModelPricingRegistry([]);
});

describe("assistantTurnCost", () => {
  it("ignores user messages", () => {
    expect(assistantTurnCost(message({ role: "user", cost: 5 }).info)).toBe(0);
  });

  it("uses the reported cost when OpenCode provides one", () => {
    expect(assistantTurnCost(message({ cost: 0.25 }).info)).toBe(0.25);
  });

  it("estimates from token pricing when no cost is reported", () => {
    const cost = assistantTurnCost(
      message({
        providerID: "openai",
        modelID: "gpt-5-mini",
        tokens: { input: 1_000_000, output: 0, reasoning: 0 },
      }).info,
    );
    expect(cost).toBeCloseTo(0.25, 6);
  });

  it("prefers manually registered pricing over the built-in catalog", () => {
    setModelPricingRegistry([
      { id: "openai", models: [{ id: "gpt-5-mini", pricing: { input: 1, output: 2 } }] },
    ]);
    const cost = assistantTurnCost(
      message({
        providerID: "openai",
        modelID: "gpt-5-mini",
        tokens: { input: 1_000_000, output: 0, reasoning: 0 },
      }).info,
    );
    expect(cost).toBeCloseTo(1, 6);
  });

  it("returns 0 when neither a cost nor pricing is available", () => {
    expect(
      assistantTurnCost(
        message({
          providerID: "anthropic",
          modelID: "claude-unknown",
          tokens: { input: 100, output: 10, reasoning: 0 },
        }).info,
      ),
    ).toBe(0);
  });
});

describe("costBreakdownByModel", () => {
  it("groups turns by model, most expensive first", () => {
    const entries = costBreakdownByModel([
      message({ id: "a", modelID: "claude-opus-5", cost: 0.2 }),
      message({ id: "b", modelID: "gpt-5", cost: 0.5 }),
      message({ id: "c", modelID: "claude-opus-5", cost: 0.1 }),
    ]);
    expect(entries).toEqual([
      { modelID: "gpt-5", cost: 0.5 },
      { modelID: "claude-opus-5", cost: expect.closeTo(0.3, 6) },
    ]);
  });

  it("skips user messages and zero-cost turns", () => {
    const entries = costBreakdownByModel([
      message({ id: "a", role: "user", modelID: "gpt-5", cost: 9 }),
      message({ id: "b", modelID: "gpt-5", cost: 0 }),
      message({ id: "c", modelID: "gpt-5", cost: 0.4 }),
    ]);
    expect(entries).toEqual([{ modelID: "gpt-5", cost: 0.4 }]);
  });

  it("folds turns without a model ID into a single unattributed entry", () => {
    const entries = costBreakdownByModel([
      message({ id: "a", cost: 0.1 }),
      message({ id: "b", cost: 0.2 }),
    ]);
    expect(entries).toEqual([{ modelID: null, cost: expect.closeTo(0.3, 6) }]);
  });

  it("returns nothing when no turn has a cost", () => {
    expect(costBreakdownByModel([message({ id: "a" })])).toEqual([]);
  });
});

describe("costBreakdownLines", () => {
  it("formats one line per model", () => {
    const lines = costBreakdownLines(
      [
        { modelID: "gpt-5", cost: 0.5 },
        { modelID: "claude-opus-5", cost: 0.3 },
      ],
      0.8,
      usd,
    );
    expect(lines).toEqual(["gpt-5: $0.5000", "claude-opus-5: $0.3000"]);
  });

  it("adds その他 for cost the loaded turns do not account for", () => {
    const lines = costBreakdownLines([{ modelID: "gpt-5", cost: 0.5 }], 0.8, usd);
    expect(lines).toEqual(["gpt-5: $0.5000", "その他: $0.3000"]);
  });

  it("omits その他 when the turns already add up", () => {
    const lines = costBreakdownLines([{ modelID: "gpt-5", cost: 0.5 }], 0.5, usd);
    expect(lines).toEqual(["gpt-5: $0.5000"]);
  });

  it("omits その他 when the total is lower than the attributed sum", () => {
    const lines = costBreakdownLines([{ modelID: "gpt-5", cost: 0.5 }], 0.2, usd);
    expect(lines).toEqual(["gpt-5: $0.5000"]);
  });

  it("labels unattributed turns", () => {
    expect(costBreakdownLines([{ modelID: null, cost: 0.5 }], 0.5, usd)).toEqual([
      "モデル不明: $0.5000",
    ]);
  });

  it("returns no lines when nothing is attributed", () => {
    expect(costBreakdownLines([], 1.5, usd)).toEqual([]);
  });
});
