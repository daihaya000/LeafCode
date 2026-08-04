import { describe, expect, it } from "vitest";
import { lastAssistantText, looksLikeCompletionReport, messageText } from "./completion-report";
import type { MessageWithParts } from "./types";

function msg(
  role: "user" | "assistant",
  text: string,
  id = `${role}-1`,
): MessageWithParts {
  return {
    info: { id, role },
    parts: [{ id: `${id}-p1`, messageID: id, type: "text", text }],
  };
}

describe("messageText", () => {
  it("joins text parts and ignores non-text parts", () => {
    const m: MessageWithParts = {
      info: { id: "a1", role: "assistant" },
      parts: [
        { id: "p1", messageID: "a1", type: "text", text: "line1" },
        { id: "p2", messageID: "a1", type: "tool", tool: "bash" },
        { id: "p3", messageID: "a1", type: "text", text: "line2" },
      ],
    };
    expect(messageText(m)).toBe("line1\nline2");
  });

  it("skips synthetic text parts (echoed prompts etc.)", () => {
    const m: MessageWithParts = {
      info: { id: "a1", role: "assistant" },
      parts: [
        { id: "p1", messageID: "a1", type: "text", text: "# 完了報告", synthetic: true },
        { id: "p2", messageID: "a1", type: "text", text: "実際の返信" },
      ],
    };
    expect(messageText(m)).toBe("実際の返信");
  });
});

describe("lastAssistantText", () => {
  it("returns the most recent assistant message's text", () => {
    const messages = [
      msg("user", "お願いします"),
      msg("assistant", "着手します", "a1"),
      msg("user", "続けて"),
      msg("assistant", "完了報告\n\nやったこと", "a2"),
    ];
    expect(lastAssistantText(messages)).toBe("完了報告\n\nやったこと");
  });

  it("returns empty string when there is no assistant message", () => {
    expect(lastAssistantText([msg("user", "hello")])).toBe("");
  });

  it("returns empty string for an empty message list", () => {
    expect(lastAssistantText([])).toBe("");
  });
});

describe("looksLikeCompletionReport", () => {
  it("matches text containing the 完了報告 heading", () => {
    expect(looksLikeCompletionReport("# 完了報告\n\nやったこと")).toBe(true);
  });

  it("does not match ordinary progress text", () => {
    expect(looksLikeCompletionReport("引き続き作業します")).toBe(false);
  });

  it("does not match empty text", () => {
    expect(looksLikeCompletionReport("")).toBe(false);
  });

  it("does not match a passing mention of the phrase in prose (regression)", () => {
    expect(
      looksLikeCompletionReport(
        "「完了報告」というルールを追加しました。作業はまだ続きます。",
      ),
    ).toBe(false);
  });

  it("matches a heading line even with surrounding paragraphs", () => {
    expect(
      looksLikeCompletionReport("前置き\n\n# 完了報告\n\nやったこと\n- 修正した"),
    ).toBe(true);
  });

  it("matches a heading padded with full-width spaces (U+3000)", () => {
    // \s doesn't cover U+3000, which is common padding around a Japanese
    // heading typed with a full-width IME.
    expect(looksLikeCompletionReport("　完了報告　\n\nやったこと")).toBe(true);
  });
});
