import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentStatePath,
  listAgents,
  setAgentEnabled,
  setAgentModel,
  setProviderEnabled,
} from "./agents";

const mockOcServer = vi.fn();
vi.mock("@/lib/oc-server", () => ({
  ocServer: (...args: unknown[]) => mockOcServer(...args),
}));

describe("agents extension", () => {
  let base: string;
  let configPath: string;
  let statePath: string;
  let projectRoot: string;
  let origAppData: string | undefined;
  let origConfigDir: string | undefined;
  let origProjectRoot: string | undefined;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "agents-ext-"));
    configPath = path.join(base, "opencode.jsonc");
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agents-ext-project-"));
    origAppData = process.env.APPDATA;
    origConfigDir = process.env.OPENCODE_CONFIG_DIR;
    origProjectRoot = process.env.OPENCODE_WEBUI_PROJECT_ROOT;
    process.env.APPDATA = base;
    process.env.OPENCODE_CONFIG_DIR = base;
    process.env.OPENCODE_WEBUI_PROJECT_ROOT = projectRoot;
    // Computed after the env vars above are set: the state path is keyed on
    // the (resolved) config directory, so it must be derived per-test rather
    // than hardcoded.
    statePath = agentStatePath();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  afterEach(() => {
    process.env.APPDATA = origAppData;
    process.env.OPENCODE_CONFIG_DIR = origConfigDir;
    process.env.OPENCODE_WEBUI_PROJECT_ROOT = origProjectRoot;
    vi.unstubAllGlobals();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
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

  it("keys local state per config directory so switching profiles doesn't leak ghost agents", async () => {
    // Regression: the profiles feature (docs/specs/opencode-config-profiles.md)
    // repoints ~/.config/opencode between entirely different directories. The
    // disabled-agent bookkeeping must not be a single shared file, or an
    // agent disabled while one profile was active reappears as a "disabled"
    // ghost row after switching to an unrelated profile that never had it.
    const live = {
      name: "b-critical-architect-opencode-go-glm-5-2",
      mode: "subagent" as const,
      model: { providerID: "opencode-go", modelID: "glm-5.2" },
    };
    mockOcServer.mockResolvedValueOnce([live]);
    fs.writeFileSync(configPath, "{}");
    await setAgentEnabled(live.name, false);
    const firstStatePath = agentStatePath();
    expect(fs.existsSync(firstStatePath)).toBe(true);

    // Switch to a different config directory (a different profile).
    const otherBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "agents-ext-other-"),
    );
    process.env.OPENCODE_CONFIG_DIR = otherBase;
    fs.writeFileSync(path.join(otherBase, "opencode.jsonc"), "{}");
    try {
      const secondStatePath = agentStatePath();
      expect(secondStatePath).not.toBe(firstStatePath);
      expect(fs.existsSync(secondStatePath)).toBe(false);

      mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
      const agents = await listAgents();
      expect(
        agents.find(
          (a) => a.name === "b-critical-architect-opencode-go-glm-5-2",
        ),
      ).toBeUndefined();
    } finally {
      fs.rmSync(otherBase, { recursive: true, force: true });
    }
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

  it("reflects a disabled state immediately even while the engine still reports the agent (pre-restart)", async () => {
    // Regression: before restart the engine keeps listing a just-disabled
    // agent as active. The config override must win so the toggle isn't
    // invisible until the user restarts OpenCode.
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(configPath, "{}");
    await setAgentEnabled("build", false);

    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    const agents = await listAgents();
    expect(agents.find((a) => a.name === "build")?.enabled).toBe(false);
  });

  it("disables a project-scoped agent in the project config, not the global one", async () => {
    // Regression: project config takes precedence over global config (see
    // resolveAgentSource), so writing `disable: true` to the global file only
    // had no effect once a project opencode.jsonc defined the same agent.
    const projectConfigPath = path.join(projectRoot, "opencode.jsonc");
    fs.writeFileSync(
      projectConfigPath,
      JSON.stringify({ agent: { reviewer: { mode: "subagent" } } }, null, 2),
    );
    fs.writeFileSync(configPath, "{}");
    mockOcServer.mockResolvedValueOnce([{ name: "reviewer", mode: "subagent" }]);

    await setAgentEnabled("reviewer", false);

    const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, "utf8"));
    expect(projectConfig.agent.reviewer.disable).toBe(true);
    const globalConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(globalConfig.agent?.reviewer).toBeUndefined();
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

  it("recovers metadata from the agent definition file", async () => {
    // Agents disabled before snapshots existed only have `disable: true`, so
    // the definition file is the only remaining source of Rank/role metadata.
    const name = "a-critical-architect-openai-gpt-5-6-sol";
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(
      configPath,
      JSON.stringify({ agent: { [name]: { disable: true } } }),
    );
    fs.mkdirSync(path.join(base, "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(base, "agents", `${name}.md`),
      [
        "---",
        "description: Critical architect subagent",
        "mode: subagent",
        "model: openai/gpt-5.6-sol",
        "temperature: 0.1",
        "---",
        "# body",
      ].join("\n"),
    );

    const agents = await listAgents();
    expect(agents.find((a) => a.name === name)).toMatchObject({
      enabled: false,
      description: "Critical architect subagent",
      mode: "subagent",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
    });
  });

  it("prefers the stored snapshot over the definition file", async () => {
    const name = "c-explore-openai-gpt-5-6-luna";
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(configPath, "{}");
    fs.mkdirSync(path.join(base, "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(base, "agents", `${name}.md`),
      "---\ndescription: from definition\nmode: subagent\n---\n",
    );
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({ disabled: { [name]: { description: "from snapshot" } } }),
    );

    const agents = await listAgents();
    expect(agents.find((a) => a.name === name)?.description).toBe(
      "from snapshot",
    );
  });

  it("ignores definition lookups for unsafe agent names", async () => {
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(
      configPath,
      JSON.stringify({ agent: { "../escape": { disable: true } } }),
    );
    const agents = await listAgents();
    expect(agents.find((a) => a.name === "../escape")).toMatchObject({
      enabled: false,
      model: undefined,
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

  it("writes model and variant overrides for a built-in agent into the config", async () => {
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(configPath, "{}");

    await setAgentModel("build", "openai/gpt-5", "high");

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.agent.build.model).toBe("openai/gpt-5");
    expect(config.agent.build.variant).toBe("high");

    // The engine (not yet restarted) still reports the agent without a model;
    // the config override must surface immediately in the listing.
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    const agents = await listAgents();
    expect(agents.find((a) => a.name === "build")).toMatchObject({
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "high",
    });
  });

  it("clears model and variant overrides", async () => {
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agent: { build: { model: "openai/gpt-5", variant: "high" } },
      }),
    );

    await setAgentModel("build", null, null);

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.agent.build.model).toBeUndefined();
    expect(config.agent.build.variant).toBeUndefined();
  });

  it("rejects model overrides without a provider/model separator", async () => {
    // Validation throws before the engine lookup, so no ocServer mock here.
    fs.writeFileSync(configPath, "{}");
    await expect(setAgentModel("build", "gpt-5", null)).rejects.toMatchObject({
      code: "invalid-name",
    });
  });

  it("bulk disables every agent of a provider", async () => {
    const openaiAgents = [
      { name: "a-explorer-openai-gpt-5", mode: "subagent", model: { providerID: "openai", modelID: "gpt-5" } },
      { name: "b-lead-openai-gpt-5", mode: "subagent", model: { providerID: "openai", modelID: "gpt-5" } },
      { name: "c-other-anthropic-claude", mode: "subagent", model: { providerID: "anthropic", modelID: "claude" } },
    ] as const;
    // setAgentEnabled calls the engine once per target; mock each.
    mockOcServer.mockResolvedValueOnce(openaiAgents);
    mockOcServer.mockResolvedValueOnce(openaiAgents);
    mockOcServer.mockResolvedValueOnce(openaiAgents);
    fs.writeFileSync(configPath, "{}");

    const count = await setProviderEnabled("openai", false);
    expect(count).toBe(2);

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.agent["a-explorer-openai-gpt-5"].disable).toBe(true);
    expect(config.agent["b-lead-openai-gpt-5"].disable).toBe(true);
    expect(config.agent["c-other-anthropic-claude"]).toBeUndefined();
  });

  it("bulk enable is idempotent and skips already-enabled agents", async () => {
    // Engine reports only b-lead active; a-explorer is disabled in config with
    // its model preserved in the disable-time snapshot (real-system shape).
    const active = [
      { name: "b-lead-openai-gpt-5", mode: "subagent", model: { providerID: "openai", modelID: "gpt-5" } },
    ] as const;
    // listAgents (1st call) + setAgentEnabled's known-check (2nd call).
    mockOcServer.mockResolvedValueOnce(active);
    mockOcServer.mockResolvedValueOnce(active);
    fs.writeFileSync(
      configPath,
      JSON.stringify({ agent: { "a-explorer-openai-gpt-5": { disable: true } } }, null, 2),
    );
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        disabled: {
          "a-explorer-openai-gpt-5": {
            mode: "subagent",
            model: { providerID: "openai", modelID: "gpt-5" },
          },
        },
      }),
    );

    const count = await setProviderEnabled("openai", true);
    expect(count).toBe(1);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.agent["a-explorer-openai-gpt-5"].disable).toBe(false);
  });

  describe("scope resolution", () => {
    it("marks an agent with no matching config/definition file as builtin", async () => {
      mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
      fs.writeFileSync(configPath, "{}");
      const agents = await listAgents();
      expect(agents.find((a) => a.name === "build")).toMatchObject({
        scope: "builtin",
        sourcePath: null,
      });
    });

    it("marks an agent defined in the global config as global", async () => {
      // `~/...` display shortening only applies when the config dir is
      // actually under the home dir; spoof that so we can assert it here
      // (the outer suite overrides `OPENCODE_CONFIG_DIR` to a plain tmpdir).
      const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(base);
      mockOcServer.mockResolvedValueOnce([
        { name: "review", mode: "subagent" },
      ]);
      fs.writeFileSync(
        configPath,
        JSON.stringify({ agent: { review: { description: "x" } } }),
      );
      try {
        const agents = await listAgents();
        expect(agents.find((a) => a.name === "review")).toMatchObject({
          scope: "global",
          sourcePath: "~/opencode.jsonc",
        });
      } finally {
        homedirSpy.mockRestore();
      }
    });

    it("marks an agent defined by a global markdown file as global", async () => {
      const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(base);
      mockOcServer.mockResolvedValueOnce([
        { name: "docs-writer", mode: "subagent" },
      ]);
      fs.writeFileSync(configPath, "{}");
      fs.mkdirSync(path.join(base, "agents"), { recursive: true });
      fs.writeFileSync(
        path.join(base, "agents", "docs-writer.md"),
        "---\ndescription: writes docs\n---\n",
      );
      try {
        const agents = await listAgents();
        expect(agents.find((a) => a.name === "docs-writer")).toMatchObject({
          scope: "global",
          sourcePath: "~/agents/docs-writer.md",
        });
      } finally {
        homedirSpy.mockRestore();
      }
    });

    it("marks an agent defined in the project config as project, taking precedence over global", async () => {
      mockOcServer.mockResolvedValueOnce([
        { name: "review", mode: "subagent" },
      ]);
      fs.writeFileSync(
        configPath,
        JSON.stringify({ agent: { review: { description: "global" } } }),
      );
      fs.writeFileSync(
        path.join(projectRoot, "opencode.jsonc"),
        JSON.stringify({ agent: { review: { description: "project" } } }),
      );
      const agents = await listAgents();
      expect(agents.find((a) => a.name === "review")).toMatchObject({
        scope: "project",
        sourcePath: "opencode.jsonc",
      });
    });

    it("marks an agent defined by a project markdown file as project", async () => {
      mockOcServer.mockResolvedValueOnce([
        { name: "code-reviewer", mode: "subagent" },
      ]);
      fs.writeFileSync(configPath, "{}");
      fs.mkdirSync(path.join(projectRoot, ".opencode", "agents"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(projectRoot, ".opencode", "agents", "code-reviewer.md"),
        "---\ndescription: reviews code\n---\n",
      );
      const agents = await listAgents();
      expect(agents.find((a) => a.name === "code-reviewer")).toMatchObject({
        scope: "project",
        sourcePath: ".opencode/agents/code-reviewer.md",
      });
    });
  });
});
