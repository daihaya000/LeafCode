import { describe, expect, it } from "vitest";
import {
  addUsage,
  formatTokens,
  lastTokenUsageFromText,
  parseTokenCountLine,
  sumUsage,
  zeroUsage,
} from "./codex-tokens";

const tokenLine = (total: number, input = 10, output = 5) =>
  JSON.stringify({
    timestamp: "2026-07-16T06:55:14.492Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: 2,
          output_tokens: output,
          reasoning_output_tokens: 1,
          total_tokens: total,
        },
      },
    },
  });

describe("parseTokenCountLine", () => {
  it("extracts total_token_usage from a token_count event", () => {
    expect(parseTokenCountLine(tokenLine(19307, 18306, 1001))).toEqual({
      inputTokens: 18306,
      cachedInputTokens: 2,
      outputTokens: 1001,
      reasoningOutputTokens: 1,
      totalTokens: 19307,
    });
  });

  it("returns null for blank, non-json, and non-token lines", () => {
    expect(parseTokenCountLine("")).toBeNull();
    expect(parseTokenCountLine("   ")).toBeNull();
    expect(parseTokenCountLine("not json")).toBeNull();
    expect(parseTokenCountLine("{ broken token_count")).toBeNull();
    expect(
      parseTokenCountLine(JSON.stringify({ payload: { type: "other" } })),
    ).toBeNull();
  });

  it("defaults missing numeric fields to 0", () => {
    const line = JSON.stringify({
      payload: { type: "token_count", info: { total_token_usage: { total_tokens: 7 } } },
    });
    expect(parseTokenCountLine(line)).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 7,
    });
  });

  it("returns null when info/total_token_usage are absent", () => {
    expect(
      parseTokenCountLine(JSON.stringify({ payload: { type: "token_count" } })),
    ).toBeNull();
    expect(
      parseTokenCountLine(
        JSON.stringify({ payload: { type: "token_count", info: {} } }),
      ),
    ).toBeNull();
  });
});

describe("lastTokenUsageFromText", () => {
  it("returns the last token_count usage (cumulative final)", () => {
    const text = [tokenLine(100), "junk", tokenLine(250), ""].join("\n");
    expect(lastTokenUsageFromText(text)?.totalTokens).toBe(250);
  });
  it("returns null when there are no token_count lines", () => {
    expect(lastTokenUsageFromText("a\nb\nc")).toBeNull();
    expect(lastTokenUsageFromText("")).toBeNull();
  });
});

describe("addUsage / sumUsage", () => {
  it("adds fields and sums a list from zero", () => {
    const a = parseTokenCountLine(tokenLine(100, 60, 40))!;
    const b = parseTokenCountLine(tokenLine(200, 120, 80))!;
    expect(addUsage(a, b).totalTokens).toBe(300);
    expect(sumUsage([a, b])).toEqual({
      inputTokens: 180,
      cachedInputTokens: 4,
      outputTokens: 120,
      reasoningOutputTokens: 2,
      totalTokens: 300,
    });
    expect(sumUsage([])).toEqual(zeroUsage());
  });
});

describe("formatTokens", () => {
  it("formats with k/M suffixes and guards non-positive", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(-5)).toBe("0");
    expect(formatTokens(NaN)).toBe("0");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(18306)).toBe("18.3k");
    expect(formatTokens(1_240_000)).toBe("1.24M");
  });
});
