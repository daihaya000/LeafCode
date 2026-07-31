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
});
