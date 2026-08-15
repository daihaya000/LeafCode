import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MEMORY_EXTRACT_MAX_ITEMS_PER_RUN,
  buildExtractionSessionBody,
  buildExtractionPrompt,
  cleanupExtractionSession,
  extractTranscriptTail,
  lastJsonBlock,
  lastMessageId,
  messageText,
  messagesAfter,
  parseExtractionJson,
} from "@/lib/memory-extract";
import type { MessageWithParts } from "@/lib/types";

vi.mock("@/lib/oc-server", () => ({
  OcError: class extends Error {},
  ocServer: vi.fn(async () => ({})),
}));

const { ocServer } = await import("@/lib/oc-server");

function part(role: "user" | "assistant", texts: string[], id: string = role): MessageWithParts {
  return {
    info: {
      id,
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

describe("messagesAfter / lastMessageId", () => {
  const transcript = [
    part("user", ["first ask"], "m1"),
    part("assistant", ["first answer"], "m2"),
    part("user", ["second ask"], "m3"),
    part("assistant", ["second answer"], "m4"),
  ];

  it("returns the whole transcript when nothing was extracted yet", () => {
    expect(messagesAfter(transcript, null)).toHaveLength(4);
    expect(messagesAfter(transcript, undefined)).toHaveLength(4);
  });

  it("returns only the messages after the cursor", () => {
    const delta = messagesAfter(transcript, "m2");
    expect(delta.map((m) => m.info.id)).toEqual(["m3", "m4"]);
    expect(extractTranscriptTail(delta, 500)).not.toContain("first ask");
  });

  it("returns an empty slice when the cursor is already at the newest message", () => {
    expect(messagesAfter(transcript, "m4")).toEqual([]);
  });

  it("falls back to the whole transcript when the cursor message is gone", () => {
    expect(messagesAfter(transcript, "pruned")).toHaveLength(4);
  });

  it("reports the newest message id and tolerates empty transcripts", () => {
    expect(lastMessageId(transcript)).toBe("m4");
    expect(lastMessageId([])).toBeNull();
    expect(lastMessageId([{ info: {}, parts: [] } as unknown as MessageWithParts])).toBeNull();
  });
});

describe("buildExtractionPrompt", () => {
  it("embeds the transcript", () => {
    const prompt = buildExtractionPrompt("the transcript");
    expect(prompt).toContain("the transcript");
    expect(prompt).toContain('"memories"');
  });

  it("caps the requested item count", () => {
    expect(buildExtractionPrompt("t")).toContain(`At most ${MEMORY_EXTRACT_MAX_ITEMS_PER_RUN} items`);
    expect(MEMORY_EXTRACT_MAX_ITEMS_PER_RUN).toBeLessThanOrEqual(3);
  });

  it("lists already stored memories so paraphrases are not re-emitted", () => {
    const prompt = buildExtractionPrompt("t", [
      "MEMORY.md は .gitignore 対象",
      "bat は CRLF で保存する",
    ]);
    expect(prompt).toContain("ALREADY STORED");
    expect(prompt).toContain("- MEMORY.md は .gitignore 対象");
    expect(prompt).toContain("- bat は CRLF で保存する");
  });

  it("flattens newlines in hints so one hint stays one bullet", () => {
    const prompt = buildExtractionPrompt("t", ["line one\nline two"]);
    expect(prompt).toContain("- line one line two");
  });

  it("omits the stored section entirely when the scope is empty", () => {
    expect(buildExtractionPrompt("t", [])).not.toContain("ALREADY STORED");
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

describe("cleanupExtractionSession", () => {
  beforeEach(() => {
    vi.mocked(ocServer).mockClear();
  });

  it("deletes a created extraction session", async () => {
    await cleanupExtractionSession("/dir", "ses-created");
    expect(vi.mocked(ocServer)).toHaveBeenCalledWith(
      "/dir",
      "/session/ses-created",
      { method: "DELETE", timeoutMs: 10_000 },
    );
  });

  it("skips the DELETE when no session was created (never hits /session/null)", async () => {
    await cleanupExtractionSession("/dir", null);
    expect(vi.mocked(ocServer)).not.toHaveBeenCalled();
  });

  it("never throws when the DELETE fails", async () => {
    vi.mocked(ocServer).mockRejectedValueOnce(new Error("boom"));
    await expect(cleanupExtractionSession("/dir", "ses-gone")).resolves.toBeUndefined();
  });
});
