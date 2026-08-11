import { describe, expect, it } from "vitest";

import {
  findResumableTurn,
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

/** An assistant message that produced a real reply. */
function reply(id: string, text = "完了"): MessageWithParts {
  return { info: { id, role: "assistant" }, parts: [textPart(`${id}-t`, id, text)] };
}

/** An assistant message with no output at all (the silent-finish shape). */
function emptyAssistant(id: string, parts: Part[] = []): MessageWithParts {
  return { info: { id, role: "assistant" }, parts };
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

describe("findResumableTurn — 中断", () => {
  it("returns the preceding user prompt for an aborted turn", () => {
    const target = findResumableTurn([userMessage("u1"), abortedAssistant("a1")]);
    expect(target).toEqual({
      reason: "aborted",
      messageId: "a1",
      text: "元のプロンプト",
      files: [],
    });
  });

  it("carries the aborted turn's agent and model so the resume matches it", () => {
    const target = findResumableTurn([
      userMessage("u1"),
      abortedAssistant("a1", { agent: "build", providerID: "anthropic", modelID: "claude" }),
    ]);
    expect(target?.agent).toBe("build");
    expect(target?.model).toEqual({ providerID: "anthropic", modelID: "claude" });
  });

  it("omits a partial model (providerID only)", () => {
    const target = findResumableTurn([
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
    const target = findResumableTurn([userMessage("u1", parts), abortedAssistant("a1")]);
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
    const target = findResumableTurn([userMessage("u1", parts), abortedAssistant("a1")]);
    expect(target?.text).toBe("一行目\n\n二行目");
  });

  it("walks past the earlier assistant messages of the same turn", () => {
    // OpenCode splits one turn into several assistant messages (per step, on
    // agent switch, after a compaction), so the message right before an abort
    // is usually another assistant message — not the prompt.
    const target = findResumableTurn([
      userMessage("u1"),
      reply("a1", "調査中"),
      abortedAssistant("a2"),
    ]);
    expect(target?.reason).toBe("aborted");
    expect(target?.messageId).toBe("a2");
    expect(target?.text).toBe("元のプロンプト");
  });

  it("uses the latest user prompt when earlier turns exist", () => {
    const target = findResumableTurn([
      userMessage("u1", [textPart("p1", "u1", "古い依頼")]),
      reply("a1"),
      userMessage("u2", [textPart("p2", "u2", "新しい依頼")]),
      abortedAssistant("a2"),
    ]);
    expect(target?.text).toBe("新しい依頼");
  });

  it("looks past trailing empty assistant placeholders", () => {
    const target = findResumableTurn([
      userMessage("u1"),
      abortedAssistant("a1"),
      emptyAssistant("a2"),
    ]);
    expect(target?.reason).toBe("aborted");
    expect(target?.messageId).toBe("a1");
  });

  it("ignores an abort that a later reply in the same turn recovered from", () => {
    expect(
      findResumableTurn([userMessage("u1"), abortedAssistant("a1"), reply("a2")]),
    ).toBeNull();
  });

  it("resumes an abort that produced no parts at all", () => {
    const empty: MessageWithParts = {
      info: {
        id: "a1",
        role: "assistant",
        error: { name: MESSAGE_ABORTED_ERROR, data: { message: "Aborted" } },
      },
      parts: [],
    };
    expect(findResumableTurn([userMessage("u1"), empty])?.messageId).toBe("a1");
  });

  it("returns null when the user already moved on past the abort", () => {
    expect(
      findResumableTurn([userMessage("u1"), abortedAssistant("a1"), userMessage("u2")]),
    ).toBeNull();
  });

  it("returns null when the original prompt has no text to resend", () => {
    const parts: Part[] = [
      { id: "p1", messageID: "u1", type: "file", url: "data:image/png;base64,x", mime: "image/png" },
    ];
    expect(findResumableTurn([userMessage("u1", parts), abortedAssistant("a1")])).toBeNull();
  });

  it("returns null when no user prompt precedes the abort", () => {
    expect(findResumableTurn([abortedAssistant("a1")])).toBeNull();
  });

  it("returns null for an empty transcript", () => {
    expect(findResumableTurn([])).toBeNull();
  });
});

describe("findResumableTurn — 無言終了", () => {
  it("resumes a turn that ended without any reply", () => {
    const target = findResumableTurn([userMessage("u1"), emptyAssistant("a1")]);
    expect(target).toEqual({
      reason: "silent",
      messageId: "a1",
      text: "元のプロンプト",
      files: [],
    });
  });

  it("keeps the agent and model of the silent turn", () => {
    const silent: MessageWithParts = {
      info: {
        id: "a1",
        role: "assistant",
        agent: "plan",
        providerID: "openai",
        modelID: "gpt-5.6",
      },
      parts: [{ id: "s1", messageID: "a1", type: "step-start" }],
    };
    const target = findResumableTurn([userMessage("u1"), silent]);
    expect(target?.reason).toBe("silent");
    expect(target?.agent).toBe("plan");
    expect(target?.model).toEqual({ providerID: "openai", modelID: "gpt-5.6" });
  });

  it("points at the last message of the silent turn", () => {
    const target = findResumableTurn([
      userMessage("u1"),
      emptyAssistant("a1", [{ id: "s1", messageID: "a1", type: "step-start" }]),
      emptyAssistant("a2"),
    ]);
    expect(target?.messageId).toBe("a2");
  });

  it("treats a whitespace-only reply as silent", () => {
    expect(findResumableTurn([userMessage("u1"), reply("a1", "   ")])?.reason).toBe("silent");
  });

  it("does not fire when the turn produced text", () => {
    expect(findResumableTurn([userMessage("u1"), reply("a1")])).toBeNull();
  });

  it("does not fire when the turn produced structured output", () => {
    const structured: MessageWithParts = {
      info: { id: "a1", role: "assistant", structured: { ok: true } },
      parts: [],
    };
    expect(findResumableTurn([userMessage("u1"), structured])).toBeNull();
  });

  it("does not fire for a non-abort error — that error is the message to show", () => {
    const failed: MessageWithParts = {
      info: { id: "a1", role: "assistant", error: { name: "APIError", data: { message: "boom" } } },
      parts: [],
    };
    expect(findResumableTurn([userMessage("u1"), failed])).toBeNull();
  });

  it("does not fire while a tool is still running or pending", () => {
    for (const status of ["running", "pending"] as const) {
      const busy: MessageWithParts = {
        info: { id: "a1", role: "assistant" },
        parts: [{ id: "t1", messageID: "a1", type: "tool", tool: "bash", state: { status } }],
      };
      expect(findResumableTurn([userMessage("u1"), busy])).toBeNull();
    }
  });

  it("fires for a tool-only turn once the tools finished without a reply", () => {
    const toolOnly: MessageWithParts = {
      info: { id: "a1", role: "assistant" },
      parts: [
        { id: "t1", messageID: "a1", type: "tool", tool: "bash", state: { status: "completed" } },
      ],
    };
    expect(findResumableTurn([userMessage("u1"), toolOnly])?.reason).toBe("silent");
  });

  it("returns null when the prompt has no assistant message yet", () => {
    // Indistinguishable from a send that is still starting up.
    expect(findResumableTurn([reply("a0"), userMessage("u1")])).toBeNull();
  });
});
