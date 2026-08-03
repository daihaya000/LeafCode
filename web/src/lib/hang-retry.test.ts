import { describe, expect, it } from "vitest";
import {
  HANG_RETRY_METADATA_KEY,
  countHangRetryUserMessages,
  hasHangRetryMarker,
  isHangRetryUserMessage,
  markHangRetryBody,
} from "./hang-retry";
import type { MessageWithParts } from "./types";

function userMessage(id: string, marked: boolean): MessageWithParts {
  return {
    info: { id, role: "user", sessionID: "ses_1" } as MessageWithParts["info"],
    parts: [
      {
        id: `${id}_p1`,
        messageID: id,
        sessionID: "ses_1",
        type: "text",
        text: "go",
        ...(marked ? { metadata: { [HANG_RETRY_METADATA_KEY]: true } } : {}),
      } as MessageWithParts["parts"][number],
    ],
  };
}

describe("markHangRetryBody", () => {
  it("marks only text parts and keeps existing metadata", () => {
    const body = {
      agent: "build",
      parts: [
        { type: "text", text: "go", metadata: { existing: "keep" } },
        { type: "file", mime: "image/png", url: "data:image/png;base64,AA" },
      ],
    };
    const marked = markHangRetryBody(body);
    expect(marked.parts).toEqual([
      {
        type: "text",
        text: "go",
        metadata: { existing: "keep", [HANG_RETRY_METADATA_KEY]: true },
      },
      { type: "file", mime: "image/png", url: "data:image/png;base64,AA" },
    ]);
    expect(marked.agent).toBe("build");
  });

  it("returns the body untouched when there are no parts (session.command)", () => {
    const body = { command: "commit", arguments: "" };
    expect(markHangRetryBody(body)).toBe(body);
  });

  it("does not mutate the input body", () => {
    const body = { parts: [{ type: "text", text: "go" }] };
    markHangRetryBody(body);
    expect(body.parts[0]).toEqual({ type: "text", text: "go" });
  });
});

describe("hasHangRetryMarker", () => {
  it("detects a marked body", () => {
    expect(hasHangRetryMarker(markHangRetryBody({ parts: [{ type: "text", text: "go" }] }))).toBe(
      true,
    );
  });

  it("rejects unmarked / malformed bodies", () => {
    expect(hasHangRetryMarker({ parts: [{ type: "text", text: "go" }] })).toBe(false);
    expect(hasHangRetryMarker({ command: "commit" })).toBe(false);
    expect(hasHangRetryMarker(null)).toBe(false);
    expect(hasHangRetryMarker([{ type: "text" }])).toBe(false);
  });
});

describe("hang retry message helpers", () => {
  it("identifies the resumed user message", () => {
    expect(isHangRetryUserMessage(userMessage("m1", true))).toBe(true);
    expect(isHangRetryUserMessage(userMessage("m2", false))).toBe(false);
  });

  it("ignores assistant messages carrying the marker", () => {
    const assistant = userMessage("m3", true);
    assistant.info = { ...assistant.info, role: "assistant" };
    expect(isHangRetryUserMessage(assistant)).toBe(false);
  });

  it("counts every automatic resume", () => {
    expect(
      countHangRetryUserMessages([
        userMessage("m1", false),
        userMessage("m2", true),
        userMessage("m3", false),
        userMessage("m4", true),
      ]),
    ).toBe(2);
  });
});
