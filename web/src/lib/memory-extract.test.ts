import { describe, expect, it } from "vitest";
import {
  buildExtractionSessionBody,
  buildExtractionPrompt,
  extractTranscriptTail,
  lastJsonBlock,
  messageText,
  parseExtractionJson,
} from "@/lib/memory-extract";
import type { MessageWithParts } from "@/lib/types";

function part(role: "user" | "assistant", texts: string[]): MessageWithParts {
  return {
    info: {
      id: role,
      role,
      agent: "plan",
      modelID: "m",
      time: { created: 0, completed: role === "assistant" ? 1 : undefined, tokens: 0, costUSD: 0 },
      data: { generationID: undefined, extra: {} },
    },
    parts: texts.map((text) => ({ type: "text", text })),
    issues: [],
    snapshots: [],
    time: undefined,
  } as unknown as MessageWithParts;
}

describe("messageText", () => {
  it("joins text parts and ignores non-text parts", () => {
    const msg = {
      info: { role: "user" },
      parts: [
        { type: "text", text: "a" },
        { type: "tool", tool: "x" },
        { type: "text", text: "b" },
      ],
    } as unknown as MessageWithParts;
    expect(messageText(msg)).toBe("a\nb");
  });
});

describe("extractTranscriptTail", () => {
  it("keeps the tail when the transcript is longer than maxChars", () => {
    const all: MessageWithParts[] = [
      part("user", ["a".repeat(100)]),
      part("assistant", ["b".repeat(100)]),
    ];
    const text = extractTranscriptTail(all, 150);
    expect(text.length).toBe(150);
    expect(text).toContain("b"); // tail keeps the later text
  });

  it("returns the full transcript when short", () => {
    const text = extractTranscriptTail([part("user", ["hi"])], 500);
    expect(text).toBe("hi");
  });
});

describe("lastJsonBlock", () => {
  it("extracts the final fenced JSON block", () => {
    const text = "intro\n```json\n{\"a\": 1}\n```\ntrailing";
    expect(lastJsonBlock(text)).toBe('{"a": 1}');
  });

  it("returns null when no fenced block exists", () => {
    expect(lastJsonBlock("no code here")).toBeNull();
  });
});

describe("parseExtractionJson", () => {
  it("parses the schema format", () => {
    const items = parseExtractionJson(
      'here\n```json\n{"memories": [{"kind": "fact", "content": "X"}, {"kind": "lesson", "content": "Y"}]}\n```',
    );
    expect(items).toEqual([
      { kind: "fact", content: "X" },
      { kind: "lesson", content: "Y" },
    ]);
  });

  it("returns null for non-JSON", () => {
    expect(parseExtractionJson("no json block")).toBeNull();
    expect(parseExtractionJson('```json\nnot json\n```')).toBeNull();
  });
});

describe("buildExtractionPrompt", () => {
  it("embeds the transcript", () => {
    const prompt = buildExtractionPrompt("the transcript");
    expect(prompt).toContain("the transcript");
    expect(prompt).toContain('"memories"');
  });
});

describe("buildExtractionSessionBody", () => {
  it("uses the OpenCode session model schema", () => {
    expect(
      buildExtractionSessionBody({
        providerID: "openai",
        modelID: "gpt-5",
        variant: "low",
      }),
    ).toEqual({
      title: "memory-extract",
      model: { providerID: "openai", id: "gpt-5", variant: "low" },
    });
  });

  it("lets OpenCode choose the default model when no model is resolved", () => {
    expect(buildExtractionSessionBody(null)).toEqual({ title: "memory-extract" });
  });
});
