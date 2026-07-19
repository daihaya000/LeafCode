import { describe, expect, it } from "vitest";
import { providerIdFromSubagentType } from "./subagent-provider";

describe("providerIdFromSubagentType", () => {
  it("matches multi-word providers, preferring the longest token", () => {
    expect(
      providerIdFromSubagentType("c-explore-opencode-go-kimi-k2-7-code"),
    ).toBe("opencode-go");
    expect(
      providerIdFromSubagentType("d-researcher-ollama-cloud-kimi-k2-7-code"),
    ).toBe("ollama-cloud");
  });

  it("matches single-word providers", () => {
    expect(
      providerIdFromSubagentType("b-lead-programmer-anthropic-claude-opus-4-8"),
    ).toBe("anthropic");
    expect(
      providerIdFromSubagentType("b-critical-architect-openai-gpt-5-6-sol"),
    ).toBe("openai");
    expect(providerIdFromSubagentType("a-worker-cursor-fast")).toBe("cursor");
    expect(providerIdFromSubagentType("a-worker-ollama-llama3")).toBe("ollama");
  });

  it("is case-insensitive", () => {
    expect(providerIdFromSubagentType("C-EXPLORE-ANTHROPIC-CLAUDE")).toBe(
      "anthropic",
    );
  });

  it("returns null for unknown or malformed input", () => {
    expect(providerIdFromSubagentType("some-random-agent")).toBeNull();
    expect(providerIdFromSubagentType("openaiish-model")).toBeNull();
    expect(providerIdFromSubagentType("")).toBeNull();
    expect(providerIdFromSubagentType(null)).toBeNull();
    expect(providerIdFromSubagentType(undefined)).toBeNull();
  });
});
