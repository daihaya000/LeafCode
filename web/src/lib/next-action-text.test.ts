import { describe, it, expect } from "vitest";
import {
  formatConversationForPrompt,
  formatPreviousSuggestionsBlock,
  normalizeSuggestion,
  extractAssistantText,
  sanitizePreviousSuggestions,
  NEXT_ACTION_SYSTEM_INSTRUCTION,
  NEXT_ACTION_TRANSCRIPT_MAX_CHARS,
  NEXT_ACTION_SUGGESTION_MAX_CHARS,
  NEXT_ACTION_PREVIOUS_MAX_COUNT,
} from "./next-action-text";
import type { MessageWithParts } from "./types";

function msg(
  role: "user" | "assistant",
  text: string,
  extra: Partial<MessageWithParts["info"]> = {},
): MessageWithParts {
  return {
    info: { id: `m-${Math.random()}`, role, ...extra },
    parts: [{ id: `p-${Math.random()}`, messageID: "m", type: "text", text }],
  };
}

describe("NEXT_ACTION_SYSTEM_INSTRUCTION", () => {
  it("is a non-empty Japanese instruction string", () => {
    expect(typeof NEXT_ACTION_SYSTEM_INSTRUCTION).toBe("string");
    expect(NEXT_ACTION_SYSTEM_INSTRUCTION.length).toBeGreaterThan(50);
    expect(NEXT_ACTION_SYSTEM_INSTRUCTION).toContain("日本語");
  });
});

describe("formatConversationForPrompt", () => {
  it("returns empty string for empty messages", () => {
    expect(formatConversationForPrompt([])).toBe("");
  });

  it("returns empty string when messages have no text parts", () => {
    const m: MessageWithParts = {
      info: { id: "m1", role: "user" },
      parts: [{ id: "p1", messageID: "m1", type: "tool", text: "skip" }],
    };
    expect(formatConversationForPrompt([m])).toBe("");
  });

  it("wraps transcript with the instruction prefix", () => {
    const out = formatConversationForPrompt([
      msg("user", "hello"),
      msg("assistant", "hi there"),
    ]);
    expect(out).toContain("以下の会話履歴に基づいて");
    expect(out).toContain("hello");
    expect(out).toContain("hi there");
  });

  it("respects the transcript char cap via buildTranscript", () => {
    const huge = msg("user", "x".repeat(NEXT_ACTION_TRANSCRIPT_MAX_CHARS + 500));
    const out = formatConversationForPrompt([huge]);
    // Output must stay within a reasonable bound (cap + wrapper overhead).
    expect(out.length).toBeLessThanOrEqual(
      NEXT_ACTION_TRANSCRIPT_MAX_CHARS + 200,
    );
  });

  it("does not include an exclusion block without previous suggestions (initial generation)", () => {
    const out = formatConversationForPrompt([msg("user", "hello")]);
    expect(out).not.toContain("既出の提案");
  });

  it("appends an exclusion block listing previous suggestions on regeneration", () => {
    const out = formatConversationForPrompt(
      [msg("user", "hello")],
      ["テストを実行してください", "エラーを修正してください"],
    );
    expect(out).toContain("【避けるべき既出の提案】");
    expect(out).toContain("- テストを実行してください");
    expect(out).toContain("- エラーを修正してください");
    // Instructs to avoid identical / substantially overlapping proposals.
    expect(out).toContain("実質的に同じ作業を指示する内容は避け");
  });

  it("returns empty for empty messages even with previous suggestions", () => {
    expect(formatConversationForPrompt([], ["テスト"])).toBe("");
  });
});

describe("formatPreviousSuggestionsBlock", () => {
  it("returns empty string for an empty list", () => {
    expect(formatPreviousSuggestionsBlock([])).toBe("");
  });

  it("lists each suggestion as a bullet under the exclusion heading", () => {
    const out = formatPreviousSuggestionsBlock(["a", "b"]);
    expect(out).toContain("【避けるべき既出の提案】");
    expect(out).toContain("- a");
    expect(out).toContain("- b");
  });
});

describe("sanitizePreviousSuggestions", () => {
  it("returns empty for non-array input", () => {
    expect(sanitizePreviousSuggestions(undefined)).toEqual([]);
    expect(sanitizePreviousSuggestions(null)).toEqual([]);
    expect(sanitizePreviousSuggestions("テスト")).toEqual([]);
    expect(sanitizePreviousSuggestions({ 0: "テスト" })).toEqual([]);
  });

  it("drops non-string and empty entries and trims whitespace", () => {
    expect(
      sanitizePreviousSuggestions(["  テスト  ", "", "   ", 42, null, {}]),
    ).toEqual(["テスト"]);
  });

  it("caps each entry to the suggestion max code points", () => {
    const long = "あ".repeat(NEXT_ACTION_SUGGESTION_MAX_CHARS + 100);
    const out = sanitizePreviousSuggestions([long]);
    expect(out).toHaveLength(1);
    expect(Array.from(out[0]!).length).toBe(NEXT_ACTION_SUGGESTION_MAX_CHARS);
  });

  it("deduplicates exact matches", () => {
    expect(sanitizePreviousSuggestions(["テスト", "テスト"])).toEqual([
      "テスト",
    ]);
  });

  it("keeps at most NEXT_ACTION_PREVIOUS_MAX_COUNT entries", () => {
    const many = Array.from({ length: NEXT_ACTION_PREVIOUS_MAX_COUNT + 3 }, (_, i) => `提案${i}`);
    const out = sanitizePreviousSuggestions(many);
    expect(out).toHaveLength(NEXT_ACTION_PREVIOUS_MAX_COUNT);
  });
});

describe("normalizeSuggestion", () => {
  it("returns empty for blank input", () => {
    expect(normalizeSuggestion("")).toBe("");
    expect(normalizeSuggestion("   \n  ")).toBe("");
  });

  it("takes the first non-empty line", () => {
    expect(normalizeSuggestion("\n\nテストを実行してください\n\n")).toBe(
      "テストを実行してください",
    );
  });

  it("strips surrounding quotes", () => {
    expect(normalizeSuggestion('"テストを実行してください"')).toBe(
      "テストを実行してください",
    );
    expect(normalizeSuggestion("`テストを実行してください`")).toBe(
      "テストを実行してください",
    );
    expect(normalizeSuggestion("「テストを実行してください」")).toBe(
      "テストを実行してください",
    );
  });

  it("strips leading numbering and bullets", () => {
    expect(normalizeSuggestion("1. テストを実行してください")).toBe(
      "テストを実行してください",
    );
    expect(normalizeSuggestion("・テストを実行してください")).toBe(
      "テストを実行してください",
    );
    expect(normalizeSuggestion("- テストを実行してください")).toBe(
      "テストを実行してください",
    );
  });

  it("caps to the max code points", () => {
    const long = "あ".repeat(NEXT_ACTION_SUGGESTION_MAX_CHARS + 50);
    const out = normalizeSuggestion(long);
    expect(Array.from(out).length).toBe(NEXT_ACTION_SUGGESTION_MAX_CHARS);
  });

  it("returns empty when only bullets remain", () => {
    expect(normalizeSuggestion("1. ")).toBe("");
    expect(normalizeSuggestion("- ")).toBe("");
  });
});

describe("extractAssistantText", () => {
  it("returns the first text part content", () => {
    expect(
      extractAssistantText({
        parts: [
          { type: "reasoning", text: "skip" },
          { type: "text", text: "テストを実行してください" },
          { type: "text", text: "ignored" },
        ],
      }),
    ).toBe("テストを実行してください");
  });

  it("returns empty when no text parts exist", () => {
    expect(extractAssistantText({ parts: [] })).toBe("");
    expect(extractAssistantText({})).toBe("");
    expect(
      extractAssistantText({ parts: [{ type: "tool", text: "x" }] }),
    ).toBe("");
  });

  it("skips whitespace-only text parts", () => {
    expect(
      extractAssistantText({
        parts: [
          { type: "text", text: "   \n" },
          { type: "text", text: "actual" },
        ],
      }),
    ).toBe("actual");
  });
});
