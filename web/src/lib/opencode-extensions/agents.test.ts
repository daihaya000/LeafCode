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
    expect(state.disabled).toContain("build");
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
    expect(state.disabled).not.toContain("build");
  });

  it("rejects unknown agents", async () => {
    mockOcServer.mockResolvedValueOnce([{ name: "build", mode: "primary" }]);
    fs.writeFileSync(configPath, "{}");
    await expect(setAgentEnabled("ghost", false)).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
