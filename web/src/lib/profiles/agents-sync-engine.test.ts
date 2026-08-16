import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("agents-sync-engine filesystem operations", () => {
  let home: string;
  let engine: typeof import("./agents-sync-engine");

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "webui-agents-sync-"));
    vi.resetModules();
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return {
        ...actual,
        default: { ...actual, homedir: () => home },
        homedir: () => home,
      };
    });
    engine = await import("./agents-sync-engine");
  });

  afterEach(() => {
    vi.doUnmock("node:os");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("creates and reads the master AGENTS.md under the configured home", () => {
    const paths = engine.agentsSyncPaths();

    expect(engine.readMasterAgents()).toEqual({
      path: paths.masterMd,
      exists: false,
      content: "",
    });

    expect(engine.writeMasterAgents("master instructions\n")).toEqual({
      path: paths.masterMd,
    });
    expect(fs.readFileSync(paths.masterMd, "utf8")).toBe("master instructions\n");
    expect(engine.readMasterAgents()).toEqual({
      path: paths.masterMd,
      exists: true,
      content: "master instructions\n",
    });
  });

  it("copies instructions and creates all skill mirrors", () => {
    const paths = engine.agentsSyncPaths();
    engine.writeMasterAgents("shared instructions\n");
    const skillPath = path.join(paths.opencodeSkills, "demo");
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(path.join(skillPath, "SKILL.md"), "demo skill\n", "utf8");

    const result = engine.applyAgentsSync();

    expect(result).toEqual({
      ok: true,
      instructions: { copied: 3, skipped: 0, errors: [] },
      skills: { created: 4, skipped: 0, errors: [] },
      hermes: { updated: 1, skipped: 0, errors: [] },
    });
    expect(fs.readFileSync(paths.claudeMd, "utf8")).toBe("shared instructions\n");
    expect(fs.readFileSync(paths.codexMd, "utf8")).toBe("shared instructions\n");
    expect(fs.readFileSync(paths.cursorMd, "utf8")).toBe("shared instructions\n");

    const status = engine.readAgentsSyncStatus();
    expect(status.skills.mirrors["claude:demo"]?.status.kind).toBe("ok");
    expect(status.skills.mirrors["codex:demo"]?.status.kind).toBe("ok");
    expect(status.skills.mirrors["agents:demo"]?.status.kind).toBe("ok");
    expect(status.skills.mirrors["cursor:demo"]?.status.kind).toBe("ok");
    expect(status.skills.hermes.status.kind).toBe("ok");
  });

  it("registers the agents skills dir in hermes config.yaml on first sync", () => {
    const paths = engine.agentsSyncPaths();
    engine.writeMasterAgents("shared instructions\n");

    const result = engine.applyAgentsSync();

    expect(result.hermes).toEqual({ updated: 1, skipped: 0, errors: [] });
    const config = fs.readFileSync(paths.hermesConfig, "utf8");
    expect(config).toContain("skills:");
    expect(config).toContain("external_dirs:");
    expect(config).toContain("- ~/.agents/skills");
    expect(engine.readAgentsSyncStatus().skills.hermes.status.kind).toBe("ok");
  });

  it("skips hermes config when external_dirs is already configured", () => {
    const paths = engine.agentsSyncPaths();
    engine.writeMasterAgents("shared instructions\n");
    fs.mkdirSync(path.dirname(paths.hermesConfig), { recursive: true });
    fs.writeFileSync(
      paths.hermesConfig,
      "skills:\n  external_dirs:\n    - ~/.agents/skills\n    - ~/shared/team-skills\n",
      "utf8",
    );

    const result = engine.applyAgentsSync();

    expect(result.hermes).toEqual({ updated: 0, skipped: 1, errors: [] });
    expect(fs.readFileSync(paths.hermesConfig, "utf8")).toBe(
      "skills:\n  external_dirs:\n    - ~/.agents/skills\n    - ~/shared/team-skills\n",
    );
  });

  it("skips hermes config when the entry is present in inline and quoted forms", () => {
    const paths = engine.agentsSyncPaths();
    engine.writeMasterAgents("shared instructions\n");
    fs.mkdirSync(path.dirname(paths.hermesConfig), { recursive: true });
    fs.writeFileSync(
      paths.hermesConfig,
      'skills:\n  external_dirs: ["~/.agents/skills", "~/shared/team-skills"]\n',
      "utf8",
    );

    const result = engine.applyAgentsSync();

    expect(result.hermes).toEqual({ updated: 0, skipped: 1, errors: [] });
  });

  it("appends into an inline external_dirs list", () => {
    const paths = engine.agentsSyncPaths();
    engine.writeMasterAgents("shared instructions\n");
    fs.mkdirSync(path.dirname(paths.hermesConfig), { recursive: true });
    fs.writeFileSync(
      paths.hermesConfig,
      "skills:\n  external_dirs: [~/shared/team-skills]\n",
      "utf8",
    );

    const result = engine.applyAgentsSync();

    expect(result.hermes).toEqual({ updated: 1, skipped: 0, errors: [] });
    expect(fs.readFileSync(paths.hermesConfig, "utf8")).toContain(
      "external_dirs: [~/shared/team-skills, ~/.agents/skills]",
    );
  });

  it("converts an empty inline external_dirs list to a block list", () => {
    const paths = engine.agentsSyncPaths();
    engine.writeMasterAgents("shared instructions\n");
    fs.mkdirSync(path.dirname(paths.hermesConfig), { recursive: true });
    fs.writeFileSync(paths.hermesConfig, "skills:\n  external_dirs: []\n", "utf8");

    const result = engine.applyAgentsSync();

    expect(result.hermes).toEqual({ updated: 1, skipped: 0, errors: [] });
    expect(fs.readFileSync(paths.hermesConfig, "utf8")).toContain(
      "external_dirs:\n    - ~/.agents/skills\n",
    );
  });

  it("merges external_dirs into an existing skills section", () => {
    const paths = engine.agentsSyncPaths();
    engine.writeMasterAgents("shared instructions\n");
    fs.mkdirSync(path.dirname(paths.hermesConfig), { recursive: true });
    fs.writeFileSync(
      paths.hermesConfig,
      "# hermes config\nskills:\n  write_approval: true\nterminal:\n  env_passthrough: true\n",
      "utf8",
    );

    const result = engine.applyAgentsSync();

    expect(result.hermes).toEqual({ updated: 1, skipped: 0, errors: [] });
    const config = fs.readFileSync(paths.hermesConfig, "utf8");
    expect(config).toContain("# hermes config");
    expect(config).toContain("write_approval: true");
    expect(config).toContain("external_dirs:\n    - ~/.agents/skills");
    expect(engine.readAgentsSyncStatus().skills.hermes.status.kind).toBe("ok");
  });

  it("appends a skills section when hermes config.yaml has no skills key", () => {
    const paths = engine.agentsSyncPaths();
    engine.writeMasterAgents("shared instructions\n");
    fs.mkdirSync(path.dirname(paths.hermesConfig), { recursive: true });
    fs.writeFileSync(paths.hermesConfig, "memory:\n  write_approval: true\n", "utf8");

    const result = engine.applyAgentsSync();

    expect(result.hermes).toEqual({ updated: 1, skipped: 0, errors: [] });
    const config = fs.readFileSync(paths.hermesConfig, "utf8");
    expect(config).toContain("memory:\n  write_approval: true\n");
    expect(config).toContain("skills:\n  external_dirs:\n    - ~/.agents/skills\n");
  });

  it("does not delete a real mirror directory when a symlink is blocked", () => {
    const paths = engine.agentsSyncPaths();
    engine.writeMasterAgents("shared instructions\n");
    const skillPath = path.join(paths.opencodeSkills, "demo");
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(path.join(skillPath, "SKILL.md"), "demo skill\n", "utf8");
    const blockedPath = path.join(paths.claudeSkills, "demo");
    fs.mkdirSync(blockedPath, { recursive: true });
    fs.writeFileSync(path.join(blockedPath, "local.txt"), "keep me\n", "utf8");

    const result = engine.applyAgentsSync();

    expect(result.ok).toBe(false);
    expect(result.skills.errors).toHaveLength(1);
    expect(result.skills.errors[0]).toContain("claude/demo");
    expect(fs.readFileSync(path.join(blockedPath, "local.txt"), "utf8")).toBe("keep me\n");
    expect(fs.lstatSync(blockedPath).isDirectory()).toBe(true);
  });

  it("does not mirror the LeafCode-only playwright-cli-wrap skill", () => {
    const paths = engine.agentsSyncPaths();
    engine.writeMasterAgents("shared instructions\n");
    const demoPath = path.join(paths.opencodeSkills, "demo");
    fs.mkdirSync(demoPath, { recursive: true });
    fs.writeFileSync(path.join(demoPath, "SKILL.md"), "demo skill\n", "utf8");
    const wrapPath = path.join(paths.opencodeSkills, "playwright-cli-wrap");
    fs.mkdirSync(wrapPath, { recursive: true });
    fs.writeFileSync(path.join(wrapPath, "SKILL.md"), "wrap skill\n", "utf8");

    const result = engine.applyAgentsSync();

    expect(result.ok).toBe(true);
    expect(result.skills).toEqual({ created: 4, skipped: 0, errors: [] });
    expect(fs.existsSync(path.join(paths.claudeSkills, "playwright-cli-wrap"))).toBe(false);
    expect(fs.existsSync(path.join(paths.codexSkills, "playwright-cli-wrap"))).toBe(false);
    expect(fs.existsSync(path.join(paths.agentsSkills, "playwright-cli-wrap"))).toBe(false);
    expect(fs.existsSync(path.join(paths.cursorSkills, "playwright-cli-wrap"))).toBe(false);

    const status = engine.readAgentsSyncStatus();
    expect(status.skills.opencodeRoot.count).toBe(1);
    expect(status.skills.mirrors["claude:demo"]?.status.kind).toBe("ok");
    expect(status.skills.mirrors["claude:playwright-cli-wrap"]).toBeUndefined();
  });
});
