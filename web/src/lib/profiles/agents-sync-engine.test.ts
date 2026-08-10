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
      instructions: { copied: 2, skipped: 0, errors: [] },
      skills: { created: 3, skipped: 0, errors: [] },
    });
    expect(fs.readFileSync(paths.claudeMd, "utf8")).toBe("shared instructions\n");
    expect(fs.readFileSync(paths.codexMd, "utf8")).toBe("shared instructions\n");

    const status = engine.readAgentsSyncStatus();
    expect(status.skills.mirrors["claude:demo"]?.status.kind).toBe("ok");
    expect(status.skills.mirrors["codex:demo"]?.status.kind).toBe("ok");
    expect(status.skills.mirrors["agents:demo"]?.status.kind).toBe("ok");
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
});
