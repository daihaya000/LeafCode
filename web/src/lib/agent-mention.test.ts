import { describe, expect, it } from "vitest";
import {
  applyAgentCompletion,
  agentDescriptionAt,
  filterAgents,
  findAgentTokens,
  parseAtQuery,
  segmentAgentHighlights,
  segmentHighlights,
  type AgentMention,
} from "./agent-mention";
import { findSkillTokens, type SlashCommand } from "./slash-command";

const agents: AgentMention[] = [
  { name: "build", label: "build", description: "Default primary agent" },
  { name: "plan", label: "plan", description: "Explores the codebase" },
  { name: "reviewer", label: "reviewer" },
];

describe("parseAtQuery", () => {
  it("detects an @ token immediately before the cursor", () => {
    expect(parseAtQuery("hello @bu", 9)).toEqual({
      start: 6,
      end: 9,
      query: "bu",
    });
  });

  it("returns null without a leading @", () => {
    expect(parseAtQuery("hello bu", 8)).toBeNull();
  });

  it("returns null when the @ is not at a token boundary", () => {
    expect(parseAtQuery("a@b", 3)).toBeNull();
  });
});

describe("filterAgents", () => {
  it("prefix matches first, capped", () => {
    const out = filterAgents(agents, "b");
    expect(out.map((a) => a.name)).toEqual(["build"]);
  });

  it("returns all when query is empty", () => {
    expect(filterAgents(agents, "").length).toBe(3);
  });
});

describe("applyAgentCompletion", () => {
  it("replaces the active @partial with @name and a trailing space", () => {
    const query = parseAtQuery("hello @bu", 9)!;
    const next = applyAgentCompletion("hello @bu", query, "build");
    expect(next.text).toBe("hello @build ");
    expect(next.cursor).toBe("hello @build ".length);
  });
});

describe("findAgentTokens", () => {
  it("locates whole @agent-name tokens", () => {
    const tokens = findAgentTokens("hi @build and @plan!", agents);
    expect(tokens.map((t) => t.name)).toEqual(["build", "plan"]);
    expect(tokens[0]).toMatchObject({ start: 3, end: 9 });
  });

  it("ignores unknown names", () => {
    expect(findAgentTokens("@nope", agents)).toEqual([]);
  });
});

describe("segmentAgentHighlights", () => {
  it("splits text into plain/agent segments", () => {
    const segs = segmentAgentHighlights("hi @build!", agents);
    expect(segs).toHaveLength(3);
    expect(segs[1]).toMatchObject({ kind: "agent", name: "build" });
  });
});

describe("agentDescriptionAt", () => {
  it("returns the description for the token under the cursor", () => {
    expect(agentDescriptionAt("hi @build!", agents, 6)).toBe(
      "Default primary agent",
    );
  });

  it("returns undefined when no token matches", () => {
    expect(agentDescriptionAt("hi", agents, 1)).toBeUndefined();
  });
});

describe("segmentHighlights (merge)", () => {
  const skills: SlashCommand[] = [
    { name: "bug-hunt", description: "Hunt bugs", source: "skill" },
  ];

  it("merges skill and agent tokens in order", () => {
    const skillRanges = findSkillTokens("/bug-hunt @build", skills);
    const segs = segmentHighlights("/bug-hunt @build", skillRanges, agents);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ kind: "skill", name: "bug-hunt" });
    expect(segs[1]).toMatchObject({ kind: "text", text: " " });
    expect(segs[2]).toMatchObject({ kind: "agent", name: "build" });
  });

  it("returns a single text segment when nothing matches", () => {
    expect(segmentHighlights("plain", [], [])).toEqual([
      { kind: "text", text: "plain" },
    ]);
  });
});