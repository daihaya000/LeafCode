import { describe, expect, it } from "vitest";
import {
  filterAgents,
  groupAgents,
  parseAgent,
  scopeLabel,
  type AgentDto,
} from "./agent-utils";

describe("parseAgent", () => {
  it("parses rank/role when name matches the kebab provider/model suffix", () => {
    const dto: AgentDto = {
      name: "b-lead-programmer-ollama-cloud-glm-5-2",
      mode: "subagent",
      model: { providerID: "ollama-cloud", modelID: "glm-5.2" },
    };
    const parsed = parseAgent(dto);
    expect(parsed.rank).toBe("B");
    expect(parsed.role).toBe("lead-programmer");
    expect(parsed.displayName).toBe("lead-programmer");
  });

  it("kebab-cases model ids with dots and slashes", () => {
    const dto: AgentDto = {
      name: "a-terra-openai-gpt-5-6-terra",
      mode: "subagent",
      model: { providerID: "openai", modelID: "gpt-5.6-terra" },
    };
    const parsed = parseAgent(dto);
    expect(parsed.rank).toBe("A");
    expect(parsed.role).toBe("terra");
  });

  it("takes the model id segment after the last slash", () => {
    const dto: AgentDto = {
      name: "c-worker-openai-gpt-5-6-terra",
      mode: "subagent",
      model: { providerID: "openai", modelID: "openai/gpt-5.6-terra" },
    };
    const parsed = parseAgent(dto);
    expect(parsed.rank).toBe("C");
    expect(parsed.role).toBe("worker");
  });

  it("leaves agents without a model unparsed", () => {
    const dto: AgentDto = {
      name: "b-lead-programmer-ollama-cloud-glm-5-2",
      mode: "subagent",
    };
    const parsed = parseAgent(dto);
    expect(parsed.rank).toBeNull();
    expect(parsed.role).toBeNull();
    expect(parsed.displayName).toBe(dto.name);
  });

  it("leaves names not starting with a rank prefix unparsed", () => {
    const dto: AgentDto = {
      name: "general",
      mode: "primary",
      model: { providerID: "openai", modelID: "gpt-5" },
    };
    const parsed = parseAgent(dto);
    expect(parsed.rank).toBeNull();
    expect(parsed.displayName).toBe("general");
  });

  it("leaves names whose suffix does not match the model unparsed", () => {
    const dto: AgentDto = {
      name: "b-lead-programmer-anthropic-claude",
      mode: "subagent",
      model: { providerID: "ollama-cloud", modelID: "glm-5.2" },
    };
    const parsed = parseAgent(dto);
    expect(parsed.rank).toBeNull();
    expect(parsed.role).toBeNull();
  });

  it("does not parse when the role would be empty", () => {
    const dto: AgentDto = {
      name: "b-openai-gpt-5",
      mode: "subagent",
      model: { providerID: "openai", modelID: "gpt-5" },
    };
    // name = "b-" + "openai-gpt-5"; suffix = "-openai-gpt-5" → role empty
    const parsed = parseAgent(dto);
    expect(parsed.rank).toBeNull();
  });
});

describe("filterAgents", () => {
  const agents = [
    parseAgent({
      name: "b-lead-programmer-ollama-cloud-glm-5-2",
      mode: "subagent",
      description: "Multi-file implementation",
      model: { providerID: "ollama-cloud", modelID: "glm-5.2" },
    }),
    parseAgent({
      name: "general",
      mode: "primary",
      description: "Default agent",
      model: { providerID: "openai", modelID: "gpt-5" },
    }),
  ];

  it("returns all agents for an empty query", () => {
    expect(filterAgents(agents, "  ")).toHaveLength(2);
  });

  it("matches by role", () => {
    const res = filterAgents(agents, "lead");
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("b-lead-programmer-ollama-cloud-glm-5-2");
  });

  it("matches by provider and model id", () => {
    expect(filterAgents(agents, "ollama")).toHaveLength(1);
    expect(filterAgents(agents, "gpt-5")).toHaveLength(1);
  });

  it("matches by description and mode", () => {
    expect(filterAgents(agents, "default")).toHaveLength(1);
    expect(filterAgents(agents, "primary")).toHaveLength(1);
  });

  it("returns nothing when no field matches", () => {
    expect(filterAgents(agents, "zzz")).toHaveLength(0);
  });

  it("matches by scope label and source path", () => {
    const scoped = [
      parseAgent({
        name: "reviewer",
        mode: "subagent",
        scope: "project",
        sourcePath: ".opencode/agents/reviewer.md",
      }),
      parseAgent({
        name: "helper",
        mode: "subagent",
        scope: "global",
        sourcePath: "~/agents/helper.md",
      }),
    ];
    expect(filterAgents(scoped, "プロジェクト")).toHaveLength(1);
    expect(filterAgents(scoped, "reviewer.md")).toHaveLength(1);
    expect(filterAgents(scoped, "グローバル")).toHaveLength(1);
  });
});

describe("scopeLabel", () => {
  it("labels each scope in Japanese, defaulting unresolved agents to builtin", () => {
    expect(scopeLabel("project")).toBe("プロジェクト");
    expect(scopeLabel("global")).toBe("グローバル");
    expect(scopeLabel("builtin")).toBe("ビルトイン");
    expect(scopeLabel(undefined)).toBe("ビルトイン");
  });
});

describe("groupAgents", () => {
  it("orders ranked groups A→E, then その他, and drops empty groups", () => {
    const agents = [
      parseAgent({
        name: "d-writer-openai-gpt-5",
        mode: "subagent",
        model: { providerID: "openai", modelID: "gpt-5" },
      }),
      parseAgent({
        name: "a-explorer-openai-gpt-5",
        mode: "subagent",
        model: { providerID: "openai", modelID: "gpt-5" },
      }),
      parseAgent({ name: "general", mode: "primary" }),
    ];
    const groups = groupAgents(agents);
    expect(groups.map((g) => g.key)).toEqual(["A", "D", "other"]);
    expect(groups[0].title).toBe("Rank A");
    expect(groups[2].title).toBe("その他のエージェント");
  });

  it("sorts ranked members by role then name", () => {
    const agents = [
      parseAgent({
        name: "a-zebra-openai-gpt-5",
        mode: "subagent",
        model: { providerID: "openai", modelID: "gpt-5" },
      }),
      parseAgent({
        name: "a-alpha-openai-gpt-5",
        mode: "subagent",
        model: { providerID: "openai", modelID: "gpt-5" },
      }),
    ];
    const [rankA] = groupAgents(agents);
    expect(rankA.agents.map((a) => a.role)).toEqual(["alpha", "zebra"]);
  });

  it("sorts the その他 group by name", () => {
    const agents = [
      parseAgent({ name: "zeta", mode: "primary" }),
      parseAgent({ name: "alpha", mode: "primary" }),
    ];
    const [other] = groupAgents(agents);
    expect(other.agents.map((a) => a.name)).toEqual(["alpha", "zeta"]);
  });
});
