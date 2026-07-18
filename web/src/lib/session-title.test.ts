import { describe, it, expect } from "vitest";
import {
  buildTranscript,
  sanitizeTitle,
  latestModelFromMessages,
} from "./session-title";
import type { MessageWithParts } from "./types";

function msg(
  role: "user" | "assistant",
  text: string,
  extra: Partial<MessageWithParts["info"]> = {},
): MessageWithParts {
  return {
    info: { id: `m-${Math.random()}`, role, ...extra },
    parts: [{ id: "p", messageID: "m", type: "text", text }],
  };
}

describe("buildTranscript", () => {
  it("joins user and assistant text with role labels", () => {
    const t = buildTranscript([msg("user", "hello"), msg("assistant", "hi")]);
    expect(t).toContain("hello");
    expect(t).toContain("hi");
  });

  it("skips non-text parts and synthetic parts", () => {
    const m: MessageWithParts = {
      info: { id: "m1", role: "user" },
      parts: [
        { id: "a", messageID: "m1", type: "text", text: "keep" },
        {
          id: "b",
          messageID: "m1",
          type: "text",
          text: "drop",
          synthetic: true,
        },
        { id: "c", messageID: "m1", type: "tool", text: "tooltext" },
      ],
    };
    const t = buildTranscript([m]);
    expect(t).toContain("keep");
    expect(t).not.toContain("drop");
    expect(t).not.toContain("tooltext");
  });

  it("keeps the latest content within the char budget", () => {
    const many = [msg("user", "OLD".repeat(100)), msg("assistant", "NEWEST")];
    const t = buildTranscript(many, 20);
    expect(t).toContain("NEWEST");
    expect(t.length).toBeLessThanOrEqual(20);
  });
});

describe("sanitizeTitle", () => {
  it("trims and takes the first non-empty line", () => {
    expect(sanitizeTitle("  Title line \n more")).toBe("Title line");
  });
  it("strips wrapping quotes", () => {
    expect(sanitizeTitle('"Hello"')).toBe("Hello");
    expect(sanitizeTitle("「タイトル」")).toBe("タイトル");
  });
  it("caps length by code points", () => {
    expect(sanitizeTitle("x".repeat(80), 60)).toHaveLength(60);
  });
  it("returns empty for blank input", () => {
    expect(sanitizeTitle("   \n  ")).toBe("");
  });
});

describe("latestModelFromMessages", () => {
  it("returns the newest assistant model info", () => {
    const m = latestModelFromMessages([
      msg("assistant", "a", { providerID: "p1", modelID: "m1" }),
      msg("assistant", "b", { providerID: "p2", modelID: "m2" }),
    ]);
    expect(m).toEqual({ providerID: "p2", modelID: "m2" });
  });
  it("returns null when no model info present", () => {
    expect(latestModelFromMessages([msg("user", "hi")])).toBeNull();
  });
});
