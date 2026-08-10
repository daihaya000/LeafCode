import { describe, expect, it } from "vitest";
import { estimateOpenAIApiCost } from "./openai-pricing";

describe("estimateOpenAIApiCost", () => {
  it("prices uncached, cached, cache-write, and reasoning tokens separately", () => {
    expect(
      estimateOpenAIApiCost({
        providerID: "openai",
        modelID: "gpt-5.6-luna",
        tokens: {
          input: 3_000_000,
          output: 100_000,
          reasoning: 50_000,
          cache: { read: 2_000_000, write: 100_000 },
        },
      }),
    ).toBeCloseTo(0.425, 12);
  });

  it("uses the Fast price table for a -fast model id", () => {
    expect(
      estimateOpenAIApiCost({
        providerID: "openai",
        modelID: "gpt-5.6-luna-fast",
        tokens: { input: 1_000_000, output: 100_000, reasoning: 0 },
      }),
    ).toBeCloseTo(0.64, 12);
  });

  it("returns null for unknown providers/models and zero usage", () => {
    const tokens = { input: 1, output: 1, reasoning: 1 };
    expect(
      estimateOpenAIApiCost({ providerID: "anthropic", modelID: "gpt-5.6-luna", tokens }),
    ).toBeNull();
    expect(
      estimateOpenAIApiCost({ providerID: "openai", modelID: "not-in-catalog", tokens }),
    ).toBeNull();
    expect(
      estimateOpenAIApiCost({
        providerID: "openai",
        modelID: "gpt-5.6-luna",
        tokens: { input: 0, output: 0, reasoning: 0 },
      }),
    ).toBeNull();
  });

  it("does not produce a negative uncached input component", () => {
    expect(
      estimateOpenAIApiCost({
        providerID: "openai",
        modelID: "gpt-5.6-luna",
        tokens: {
          input: 100,
          output: 0,
          reasoning: 0,
          cache: { read: 1_000, write: 0 },
        },
      }),
    ).toBeCloseTo(0.00002, 12);
  });
});
