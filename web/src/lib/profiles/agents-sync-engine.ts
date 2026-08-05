/**
 * agents-sync engine — global AGENTS.md/skills -> claude/codex/opencode.
 *
 * Inspired by https://github.com/DevsProtein/agents-sync
 * Keeps one canonical copy in the global claude config dir and mirrors it
 * to the other tools' global config dirs.
 *
 * Master (canonical, global):
 *   - ~/.claude/CLAUDE.md
 *   - ~/.claude/skills/<name>/
 *
 * Mirrors:
 *   - ~/.codex/AGENTS.md              (copied from CLAUDE.md)
 *   - ~/.config/opencode/opencode.jsonc instructions (adds CLAUDE.md)
 *   - ~/.codex/skills/<name>/        -> symlink to ~/.claude/skills/<name>
 *   - ~/.config/opencode/skills/<name>/ -> symlink to ~/.claude/skills/<name>
 *   - ~/.agents/skills/<name>/       -> symlink to ~/.claude/skills/<name>
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJsonc, writeJsonc } from "./jsonc";

const HOME = os.homedir();

export type AgentsSyncItemStatus =
  | { kind: "ok"; message: string }
  | { kind: "missing"; message: string }
  | { kind: "wouldChange"; message: string }
  | { kind: "blocked"; message: string };

export type AgentsSyncStatus = {
  instructions: {
    master: { path: string; exists: boolean };
    codex: { path: string; status: AgentsSyncItemStatus };
    opencode: { path: string; status: AgentsSyncItemStatus };
  };
  skills: {
    claudeRoot: { path: string; exists: boolean; count: number };
    mirrors: Record<string, { path: string; status: AgentsSyncItemStatus }>;
  };
};

export type AgentsSyncResult = {
  ok: boolean;
  instructions: { copied: number; skipped: number; errors: string[] };
  skills: { created: number; skipped: number; errors: string[] };
  error?: string;
};

function paths() {
  return {
    masterMd: path.join(HOME, ".claude", "CLAUDE.md"),
    codexMd: path.join(HOME, ".codex", "AGENTS.md"),
    opencodeConfig: path.join(HOME, ".config", "opencode", "opencode.jsonc"),
    claudeSkills: path.join(HOME, ".claude", "skills"),
    codexSkills: path.join(HOME, ".codex", "skills"),
    opencodeSkills: path.join(HOME, ".config", "opencode", "skills"),
    agentsSkills: path.join(HOME, ".agents", "skills"),
  };
}

function readIfExists(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function mkdirp(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function readDirNames(p: string): string[] {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** True if a path is a symlink pointing at the given target. */
function isSymlinkTo(linkPath: string, target: string): boolean {
  try {
    const stat = fs.lstatSync(linkPath);
    if (!stat.isSymbolicLink()) return false;
    const cur = fs.readlinkSync(linkPath);
    return path.resolve(linkPath, cur) === path.resolve(target);
  } catch {
    return false;
  }
}

/** Best-effort cross-platform directory symlink. Falls back to junction on Windows. */
function symlinkDir(target: string, linkPath: string): void {
  mkdirp(path.dirname(linkPath));
  if (fs.existsSync(linkPath) || fs.lstatSync(linkPath, { throwIfNoEntry: false })) {
    fs.rmSync(linkPath, { recursive: true, force: true });
  }
  if (process.platform === "win32") {
    try {
      fs.symlinkSync(path.resolve(target), linkPath, "junction");
      return;
    } catch {
      // fall through to dir symlink; requires Windows Developer Mode
    }
  }
  fs.symlinkSync(target, linkPath, "dir");
}

function compareStatus(masterPath: string, mirrorPath: string): AgentsSyncItemStatus {
  if (!fs.existsSync(masterPath)) {
    return { kind: "missing", message: "master not found" };
  }
  const master = readIfExists(masterPath);
  const mirror = readIfExists(mirrorPath);
  if (mirror === null) {
    return { kind: "wouldChange", message: "will copy from master" };
  }
  if (master === mirror) {
    return { kind: "ok", message: "contents match" };
  }
  return { kind: "wouldChange", message: "contents differ; will overwrite from master" };
}

function opencodeInstructionsStatus(configPath: string, masterPath: string): AgentsSyncItemStatus {
  if (!fs.existsSync(configPath)) {
    return { kind: "missing", message: "opencode config not found" };
  }
  try {
    const cfg = readJsonc(configPath);
    const instructions: string[] = Array.isArray(cfg.instructions) ? cfg.instructions : [];
    const resolved = instructions.map((i) => path.resolve(path.dirname(configPath), i));
    if (resolved.includes(path.resolve(masterPath))) {
      return { kind: "ok", message: "CLAUDE.md already in instructions" };
    }
    return { kind: "wouldChange", message: "will add CLAUDE.md to instructions" };
  } catch (err) {
    return { kind: "blocked", message: err instanceof Error ? err.message : String(err) };
  }
}

function instructionsStatus(): AgentsSyncStatus["instructions"] {
  const p = paths();
  const masterExists = fs.existsSync(p.masterMd);
  return {
    master: { path: p.masterMd, exists: masterExists },
    codex: { path: p.codexMd, status: compareStatus(p.masterMd, p.codexMd) },
    opencode: {
      path: p.opencodeConfig,
      status: opencodeInstructionsStatus(p.opencodeConfig, p.masterMd),
    },
  };
}

function skillsStatus(): AgentsSyncStatus["skills"] {
  const p = paths();
  const names = readDirNames(p.claudeSkills);
  const mirrors: Record<string, { path: string; status: AgentsSyncItemStatus }> = {};
  for (const name of names) {
    const claudePath = path.join(p.claudeSkills, name);
    const targets: Record<string, string> = {
      codex: path.join(p.codexSkills, name),
      opencode: path.join(p.opencodeSkills, name),
      agents: path.join(p.agentsSkills, name),
    };
    for (const [side, linkPath] of Object.entries(targets)) {
      const key = `${side}:${name}`;
      if (isSymlinkTo(linkPath, claudePath)) {
        mirrors[key] = { path: linkPath, status: { kind: "ok", message: "symlink correct" } };
      } else if (fs.existsSync(linkPath)) {
        mirrors[key] = {
          path: linkPath,
          status: { kind: "blocked", message: "exists but is not the correct symlink" },
        };
      } else {
        mirrors[key] = { path: linkPath, status: { kind: "wouldChange", message: "will create symlink" } };
      }
    }
  }
  return {
    claudeRoot: { path: p.claudeSkills, exists: fs.existsSync(p.claudeSkills), count: names.length },
    mirrors,
  };
}

export function readAgentsSyncStatus(): AgentsSyncStatus {
  return {
    instructions: instructionsStatus(),
    skills: skillsStatus(),
  };
}

export function applyAgentsSync(): AgentsSyncResult {
  const p = paths();
  const result: AgentsSyncResult = {
    ok: true,
    instructions: { copied: 0, skipped: 0, errors: [] },
    skills: { created: 0, skipped: 0, errors: [] },
  };

  if (!fs.existsSync(p.masterMd)) {
    result.ok = false;
    result.error = `master not found: ${p.masterMd}`;
    return result;
  }

  // --- instructions ---------------------------------------------------------
  try {
    mkdirp(path.dirname(p.codexMd));
    const current = readIfExists(p.codexMd);
    const master = fs.readFileSync(p.masterMd, "utf8");
    if (current === master) {
      result.instructions.skipped++;
    } else {
      fs.writeFileSync(p.codexMd, master, "utf8");
      result.instructions.copied++;
    }
  } catch (err) {
    result.instructions.errors.push(
      `codex: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (fs.existsSync(p.opencodeConfig)) {
    try {
      const cfg = readJsonc(p.opencodeConfig);
      const instructions: string[] = Array.isArray(cfg.instructions) ? cfg.instructions : [];
      const resolved = instructions.map((i) => path.resolve(path.dirname(p.opencodeConfig), i));
      if (!resolved.includes(path.resolve(p.masterMd))) {
        instructions.push(p.masterMd);
        cfg.instructions = instructions;
        writeJsonc(p.opencodeConfig, cfg);
        result.instructions.copied++;
      } else {
        result.instructions.skipped++;
      }
    } catch (err) {
      result.instructions.errors.push(
        `opencode: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // --- skills ---------------------------------------------------------------
  if (fs.existsSync(p.claudeSkills)) {
    const names = readDirNames(p.claudeSkills);
    for (const name of names) {
      const claudePath = path.join(p.claudeSkills, name);
      const linkPaths = [p.codexSkills, p.opencodeSkills, p.agentsSkills];
      for (const root of linkPaths) {
        const linkPath = path.join(root, name);
        try {
          if (isSymlinkTo(linkPath, claudePath)) {
            result.skills.skipped++;
          } else {
            symlinkDir(claudePath, linkPath);
            result.skills.created++;
          }
        } catch (err) {
          result.skills.errors.push(
            `${path.basename(root)}/${name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  if (result.instructions.errors.length || result.skills.errors.length) {
    result.ok = false;
  }
  return result;
}
