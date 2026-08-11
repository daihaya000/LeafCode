import { describe, expect, it } from "vitest";

import {
  findAbortedResumeTarget,
  isAbortedAssistantMessage,
  MESSAGE_ABORTED_ERROR,
} from "./aborted-resume";
import type { MessageWithParts, Part } from "./types";

function textPart(id: string, messageID: string, text: string, synthetic = false): Part {
  return { id, messageID, type: "text", text, ...(synthetic ? { synthetic } : {}) };
}

function userMessage(
  id: string,
  parts: Part[] = [textPart(`${id}-t`, id, "元のプロンプト")],
): MessageWithParts {
  return { info: { id, role: "user" }, parts };
}

function abortedAssistant(id: string, extra: Record<string, unknown> = {}): MessageWithParts {
  return {
    info: {
      id,
      role: "assistant",
      error: { name: MESSAGE_ABORTED_ERROR, data: { message: "Aborted" } },
      ...extra,
    },
    parts: [textPart(`${id}-t`, id, "途中まで")],
  };
}

describe("isAbortedAssistantMessage", () => {
  it("detects an aborted assistant turn", () => {
    expect(isAbortedAssistantMessage(abortedAssistant("a1"))).toBe(true);
  });

  it("ignores other assistant errors", () => {
    const message: MessageWithParts = {
      info: { id: "a1", role: "assistant", error: { name: "APIError", data: { message: "boom" } } },
      parts: [],
    };
    expect(isAbortedAssistantMessage(message)).toBe(false);
  });

  it("ignores user messages", () => {
    expect(isAbortedAssistantMessage(userMessage("u1"))).toBe(false);
  });
});

describe("findAbortedResumeTarget", () => {
  it("returns the preceding user prompt for a trailing aborted turn", () => {
    const target = findAbortedResumeTarget([userMessage("u1"), abortedAssistant("a1")]);
    expect(target).toEqual({ messageId: "a1", text: "元のプロンプト", files: [] });
  });

  it("carries the aborted turn's agent and model so the resume matches it", () => {
    const target = findAbortedResumeTarget([
      userMessage("u1"),
      abortedAssistant("a1", { agent: "build", providerID: "anthropic", modelID: "claude" }),
    ]);
    expect(target?.agent).toBe("build");
    expect(target?.model).toEqual({ providerID: "anthropic", modelID: "claude" });
  });

  it("omits a partial model (providerID only)", () => {
    const target = findAbortedResumeTarget([
      userMessage("u1"),
      abortedAssistant("a1", { providerID: "anthropic" }),
    ]);
    expect(target?.model).toBeUndefined();
  });

  it("restores file attachments from the original prompt", () => {
    const parts: Part[] = [
      textPart("p1", "u1", "この画像を見て"),
      { id: "p2", messageID: "u1", type: "file", url: "data:image/png;base64,x", mime: "image/png", filename: "a.png" },
      { id: "p3", messageID: "u1", type: "file", url: "data:image/png;base64,y", mime: "image/png" },
      { id: "p4", messageID: "u1", type: "file", mime: "image/png" },
    ];
    const target = findAbortedResumeTarget([userMessage("u1", parts), abortedAssistant("a1")]);
    expect(target?.files).toEqual([
      { uri: "data:image/png;base64,x", mime: "image/png", name: "a.png" },
      { uri: "data:image/png;base64,y", mime: "image/png" },
    ]);
  });

  it("joins multiple text parts and drops synthetic ones", () => {
    const parts = [
      textPart("p1", "u1", "一行目"),
      textPart("p2", "u1", "二行目"),
      textPart("p3", "u1", "システム追記", true),
    ];
    const target = findAbortedResumeTarget([userMessage("u1", parts), abortedAssistant("a1")]);
    expect(target?.text).toBe("一行目\n\n二行目");
  });

  it("returns null when the conversation moved on past the abort", () => {
    const completed: MessageWithParts = {
      info: { id: "a2", role: "assistant" },
      parts: [textPart("a2-t", "a2", "完了")],
    };
    expect(
      findAbortedResumeTarget([userMessage("u1"), abortedAssistant("a1"), completed]),
    ).toBeNull();
  });

  it("returns null when the last message is a user prompt", () => {
    expect(
      findAbortedResumeTarget([userMessage("u1"), abortedAssistant("a1"), userMessage("u2")]),
    ).toBeNull();
  });

  it("walks past the earlier assistant messages of the same turn", () => {
    // OpenCode splits one turn into several assistant messages (per step, on
    // agent switch, after a compaction), so the message right before an abort
    // is usually another assistant message — not the prompt.
    const step: MessageWithParts = {
      info: { id: "a1", role: "assistant" },
      parts: [textPart("a1-t", "a1", "調査中")],
    };
    const target = findAbortedResumeTarget([
      userMessage("u1"),
      step,
      abortedAssistant("a2"),
    ]);
    expect(target).toEqual({ messageId: "a2", text: "元のプロンプト", files: [] });
  });

  it("uses the latest user prompt when earlier turns exist", () => {
    const oldPrompt = userMessage("u1", [textPart("p1", "u1", "古い依頼")]);
    const oldReply: MessageWithParts = {
      info: { id: "a1", role: "assistant" },
      parts: [textPart("a1-t", "a1", "完了")],
    };
    const target = findAbortedResumeTarget([
      oldPrompt,
      oldReply,
      userMessage("u2", [textPart("p2", "u2", "新しい依頼")]),
      abortedAssistant("a2"),
    ]);
    expect(target?.text).toBe("新しい依頼");
  });

  it("returns null when the original prompt has no text to resend", () => {
    const parts: Part[] = [
      { id: "p1", messageID: "u1", type: "file", url: "data:image/png;base64,x", mime: "image/png" },
    ];
    expect(findAbortedResumeTarget([userMessage("u1", parts), abortedAssistant("a1")])).toBeNull();
  });

  it("returns null when no user prompt precedes the abort", () => {
    expect(findAbortedResumeTarget([abortedAssistant("a1")])).toBeNull();
  });

  it("returns null for an empty transcript", () => {
    expect(findAbortedResumeTarget([])).toBeNull();
  });

  it("looks past trailing empty assistant placeholders", () => {
    // The engine leaves content-less assistant messages behind; they must not
    // hide the abort that precedes them.
    const placeholder: MessageWithParts = {
      info: { id: "a2", role: "assistant" },
      parts: [],
    };
    const target = findAbortedResumeTarget([
      userMessage("u1"),
      abortedAssistant("a1"),
      placeholder,
    ]);
    expect(target?.messageId).toBe("a1");
  });

  it("still ignores a trailing assistant message that produced output", () => {
    const completed: MessageWithParts = {
      info: { id: "a2", role: "assistant" },
      parts: [textPart("a2-t", "a2", "完了")],
    };
    expect(
      findAbortedResumeTarget([userMessage("u1"), abortedAssistant("a1"), completed]),
    ).toBeNull();
  });

  it("resumes an abort that produced no parts at all", () => {
    // A stop pressed immediately after send leaves an empty assistant message
    // carrying only the error — nothing renders for it in the transcript.
    const empty: MessageWithParts = {
      info: {
        id: "a1",
        role: "assistant",
        error: { name: MESSAGE_ABORTED_ERROR, data: { message: "Aborted" } },
      },
      parts: [],
    };
    expect(findAbortedResumeTarget([userMessage("u1"), empty])?.messageId).toBe("a1");
  });
});
