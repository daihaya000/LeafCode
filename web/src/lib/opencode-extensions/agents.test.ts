import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAgents, setAgentEnabled } from "./agents";

const mockOcServer = vi.fn();
vi.mock("@/lib/oc-server", () => ({
  ocServer: (...args: unknown[]) => mockOcServer(...args),
}));

describe("agents extension", () => {
  let base: string;
  let configPath: string;
  let statePath: string;
  let origAppData: string | undefined;
  let origConfigDir: string | undefined;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "agents-ext-"));
    configPath = path.join(base, "opencode.jsonc");
    statePath = path.join(base, "opencode-webui", "agent-state.json");
    origAppData = process.env.APPDATA;
    origConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.APPDATA = base;
    process.env.OPENCODE_CONFIG_DIR = base;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  afterEach(() => {
    process.env.APPDATA = origAppData;
    process.env.OPENCODE_CONFIG_DIR = origConfigDir;
    vi.unstubAllGlobals();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("lists active agents from engine", async () => {
    mockOcServer.mockResolvedValueOnce([
      { name: "build", mode: "primary" },
      { name: "explore", mode: "subagent" },
    ]);
    fs.writeFileSync(configPath, "{}");
    const agents = await listAgents();
    expect(agents).toHaveLength(2);
    expect(agents.every((a) => a.enabled)).toBe(true);
  });

  it("merges disabled agents from config", async () => {
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(
      configPath,
      JSON.stringify({ agent: { explore: { disable: true, mode: "subagent" } } }, null, 2),
    );
    const agents = await listAgents();
    expect(agents.map((a) => [a.name, a.enabled])).toEqual([
      ["build", true],
      ["explore", false],
    ]);
  });

  it("merges disabled agents from local state", async () => {
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(configPath, "{}");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ disabled: ["legacy"] }));
    const agents = await listAgents();
    const legacy = agents.find((a) => a.name === "legacy");
    expect(legacy?.enabled).toBe(false);
  });

  it("disables an active agent in config and state", async () => {
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(configPath, "{}");
    await setAgentEnabled("build", false);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.agent.build.disable).toBe(true);
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(Object.keys(state.disabled)).toContain("build");
  });

  it("enables a previously disabled agent", async () => {
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(
      configPath,
      JSON.stringify({ agent: { build: { disable: true } } }, null, 2),
    );
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ disabled: ["build"] }));
    await setAgentEnabled("build", true);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.agent.build.disable).toBe(false);
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(Object.keys(state.disabled)).not.toContain("build");
  });

  it("remembers metadata when disabling so rank stays resolvable", async () => {
    const live = {
      name: "a-critical-architect-anthropic-claude-fable-5",
      description: "critical architect",
      mode: "subagent" as const,
      model: { providerID: "anthropic", modelID: "claude-fable-5" },
    };
    mockOcServer.mockResolvedValueOnce([live]);
    fs.writeFileSync(configPath, "{}");
    await setAgentEnabled(live.name, false);

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(state.disabled[live.name]).toEqual({
      description: "critical architect",
      mode: "subagent",
      model: { providerID: "anthropic", modelID: "claude-fable-5" },
    });

    // The engine stops reporting a disabled agent; the listing must still
    // expose model/description so the table can derive Rank and role.
    mockOcServer.mockResolvedValueOnce([]);
    const agents = await listAgents();
    const row = agents.find((a) => a.name === live.name);
    expect(row).toMatchObject({
      enabled: false,
      description: "critical architect",
      mode: "subagent",
      model: { providerID: "anthropic", modelID: "claude-fable-5" },
    });
  });

  it("fills config-only disabled entries from the snapshot", async () => {
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(
      configPath,
      JSON.stringify({ agent: { "c-explore-openai-gpt-5-6-luna": { disable: true } } }),
    );
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        disabled: {
          "c-explore-openai-gpt-5-6-luna": {
            description: "explorer",
            mode: "subagent",
            model: { providerID: "openai", modelID: "gpt-5-6-luna" },
          },
        },
      }),
    );
    const agents = await listAgents();
    expect(agents.find((a) => a.name === "c-explore-openai-gpt-5-6-luna")).toMatchObject({
      enabled: false,
      description: "explorer",
      model: { providerID: "openai", modelID: "gpt-5-6-luna" },
    });
  });

  it("reads config model overrides written as provider/model strings", async () => {
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agent: {
          "d-researcher-openai-gpt-5-5": {
            disable: true,
            model: "openai/gpt-5-5",
          },
        },
      }),
    );
    const agents = await listAgents();
    expect(agents.find((a) => a.name === "d-researcher-openai-gpt-5-5")).toMatchObject({
      enabled: false,
      model: { providerID: "openai", modelID: "gpt-5-5" },
    });
  });

  it("rejects unknown agents", async () => {
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(configPath, "{}");
    await expect(setAgentEnabled("ghost", false)).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
