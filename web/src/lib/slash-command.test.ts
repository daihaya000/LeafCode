import { describe, expect, it } from "vitest";
import {
  applySlashCompletion,
  filterCommands,
  normalizeCommands,
  parseCommandSubmit,
  parseSlashQuery,
  segmentSkillHighlights,
  skillDescriptionAt,
  type SlashCommand,
} from "./slash-command";

const COMMANDS: SlashCommand[] = [
  { name: "loop", description: "Run on an interval", source: "skill" },
  { name: "babysit", description: "Watch a PR", source: "skill" },
  { name: "init", description: "Initialize", source: "command" },
  { name: "compact", source: "command" },
];

describe("parseSlashQuery", () => {
  it("detects a leading slash token", () => {
    expect(parseSlashQuery("/lo", 3)).toEqual({
      start: 0,
      end: 3,
      query: "lo",
    });
  });

  it("detects a slash after whitespace", () => {
    expect(parseSlashQuery("hello /bab", 10)).toEqual({
      start: 6,
      end: 10,
      query: "bab",
    });
  });

  it("ignores path-like slashes", () => {
    expect(parseSlashQuery("src/lib/foo", 11)).toBeNull();
  });

  it("returns empty query for bare slash", () => {
    expect(parseSlashQuery("/", 1)).toEqual({
      start: 0,
      end: 1,
      query: "",
    });
  });

  it("closes once a space follows the token", () => {
    expect(parseSlashQuery("/loop ", 6)).toBeNull();
  });
});

describe("filterCommands", () => {
  it("prefers prefix matches", () => {
    expect(filterCommands(COMMANDS, "lo").map((c) => c.name)).toEqual([
      "loop",
    ]);
  });

  it("lists all when query is empty", () => {
    expect(filterCommands(COMMANDS, "").map((c) => c.name)).toEqual([
      "babysit",
      "compact",
      "init",
      "loop",
    ]);
  });

  it("matches substrings after prefixes", () => {
    expect(filterCommands(COMMANDS, "sit").map((c) => c.name)).toEqual([
      "babysit",
    ]);
  });
});

describe("applySlashCompletion", () => {
  it("replaces the partial token and leaves a trailing space", () => {
    const query = parseSlashQuery("/lo", 3)!;
    expect(applySlashCompletion("/lo", query, "loop")).toEqual({
      text: "/loop ",
      cursor: 6,
    });
  });

  it("preserves surrounding text without a double space", () => {
    const text = "hi /ba there";
    const query = parseSlashQuery(text, 6)!;
    expect(applySlashCompletion(text, query, "babysit")).toEqual({
      text: "hi /babysit there",
      cursor: 12,
    });
  });
});

describe("parseCommandSubmit", () => {
  it("parses a known command with arguments", () => {
    expect(parseCommandSubmit("/loop 5m check", COMMANDS)).toEqual({
      command: "loop",
      arguments: "5m check",
    });
  });

  it("parses a known command with empty arguments", () => {
    expect(parseCommandSubmit("/init", COMMANDS)).toEqual({
      command: "init",
      arguments: "",
    });
  });

  it("returns null for unknown slash commands", () => {
    expect(parseCommandSubmit("/unknown args", COMMANDS)).toBeNull();
  });

  it("returns null for plain prompts", () => {
    expect(parseCommandSubmit("hello world", COMMANDS)).toBeNull();
  });
});

describe("normalizeCommands", () => {
  it("keeps valid entries only", () => {
    expect(
      normalizeCommands([
        { name: "loop", description: "d", source: "skill" },
        { name: "  " },
        null,
        { foo: 1 },
        { name: "init" },
      ]),
    ).toEqual([
      { name: "loop", description: "d", source: "skill" },
      { name: "init" },
    ]);
  });
});

describe("skill highlighting", () => {
  it("detects only source=skill tokens", () => {
    expect(isSkillCommand(COMMANDS[0]!)).toBe(true);
    expect(isSkillCommand(COMMANDS[2]!)).toBe(false);
    expect(findSkillTokens("/loop /init /babysit", COMMANDS)).toEqual([
      {
        start: 0,
        end: 5,
        name: "loop",
        description: "Run on an interval",
      },
      {
        start: 12,
        end: 20,
        name: "babysit",
        description: "Watch a PR",
      },
    ]);
  });

  it("segments text so skills stay blue in the composer overlay", () => {
    expect(segmentSkillHighlights("/loop now", COMMANDS)).toEqual([
      {
        kind: "skill",
        text: "/loop",
        name: "loop",
        description: "Run on an interval",
      },
      { kind: "text", text: " now" },
    ]);
    expect(skillDescriptionAt("/loop now", COMMANDS)).toBe(
      "Run on an interval",
    );
  });
});

describe("skill token highlights", () => {
  it("detects only source=skill slash tokens", () => {
    expect(isSkillCommand(COMMANDS[0]!)).toBe(true);
    expect(isSkillCommand(COMMANDS[2]!)).toBe(false);
    expect(findSkillTokens("/loop and /init", COMMANDS)).toEqual([
      {
        start: 0,
        end: 5,
        name: "loop",
        description: "Run on an interval",
      },
    ]);
  });

  it("segments skill tokens for blue rendering and hover descriptions", () => {
    expect(segmentSkillHighlights("Please /loop now", COMMANDS)).toEqual([
      { kind: "text", text: "Please " },
      {
        kind: "skill",
        text: "/loop",
        name: "loop",
        description: "Run on an interval",
      },
      { kind: "text", text: " now" },
    ]);
    expect(segmentSkillHighlights("/init", COMMANDS)).toEqual([
      { kind: "text", text: "/init" },
    ]);
    expect(skillDescriptionAt("/babysit please", COMMANDS)).toBe("Watch a PR");
    expect(skillDescriptionAt("/loop and later", COMMANDS, 1)).toBe(
      "Run on an interval",
    );
    expect(skillDescriptionAt("/init", COMMANDS)).toBeUndefined();
  });
});
