/**
 * agents-sync engine — global AGENTS.md/skills -> claude/codex/opencode.
 *
 * Inspired by https://github.com/DevsProtein/agents-sync
 * Keeps one canonical copy in the global opencode config dir and mirrors it
 * to the other tools' global config dirs.
 *
 * Master (canonical, global):
 *   - ~/.config/opencode/AGENTS.md
 *   - ~/.config/opencode/skills/<name>/
 *
 * Mirrors:
 *   - ~/.claude/CLAUDE.md              (copied from AGENTS.md)
 *   - ~/.codex/AGENTS.md              (copied from AGENTS.md)
 *   - ~/.claude/skills/<name>/        -> symlink to ~/.config/opencode/skills/<name>
 *   - ~/.codex/skills/<name>/        -> symlink to ~/.config/opencode/skills/<name>
 *   - ~/.agents/skills/<name>/       -> symlink to ~/.config/opencode/skills/<name>
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();

export type AgentsSyncItemStatus =
  | { kind: "ok"; message: string }
  | { kind: "missing"; message: string }
  | { kind: "wouldChange"; message: string }
  | { kind: "blocked"; message: string };

export type AgentsSyncStatus = {
  instructions: {
    master: { path: string; exists: boolean };
    claude: { path: string; status: AgentsSyncItemStatus };
    codex: { path: string; status: AgentsSyncItemStatus };
  };
  skills: {
    opencodeRoot: { path: string; exists: boolean; count: number };
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
    masterMd: path.join(HOME, ".config", "opencode", "AGENTS.md"),
    claudeMd: path.join(HOME, ".claude", "CLAUDE.md"),
    codexMd: path.join(HOME, ".codex", "AGENTS.md"),
    opencodeSkills: path.join(HOME, ".config", "opencode", "skills"),
    claudeSkills: path.join(HOME, ".claude", "skills"),
    codexSkills: path.join(HOME, ".codex", "skills"),
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

function instructionsStatus(): AgentsSyncStatus["instructions"] {
  const p = paths();
  const masterExists = fs.existsSync(p.masterMd);
  return {
    master: { path: p.masterMd, exists: masterExists },
    claude: { path: p.claudeMd, status: compareStatus(p.masterMd, p.claudeMd) },
    codex: { path: p.codexMd, status: compareStatus(p.masterMd, p.codexMd) },
  };
}

function skillsStatus(): AgentsSyncStatus["skills"] {
  const p = paths();
  const names = readDirNames(p.opencodeSkills);
  const mirrors: Record<string, { path: string; status: AgentsSyncItemStatus }> = {};
  for (const name of names) {
    const masterPath = path.join(p.opencodeSkills, name);
    const targets: Record<string, string> = {
      claude: path.join(p.claudeSkills, name),
      codex: path.join(p.codexSkills, name),
      agents: path.join(p.agentsSkills, name),
    };
    for (const [side, linkPath] of Object.entries(targets)) {
      const key = `${side}:${name}`;
      if (isSymlinkTo(linkPath, masterPath)) {
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
    opencodeRoot: { path: p.opencodeSkills, exists: fs.existsSync(p.opencodeSkills), count: names.length },
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
  const masterText = fs.readFileSync(p.masterMd, "utf8");
  for (const [side, targetPath] of Object.entries({
    claude: p.claudeMd,
    codex: p.codexMd,
  })) {
    try {
      mkdirp(path.dirname(targetPath));
      const current = readIfExists(targetPath);
      if (current === masterText) {
        result.instructions.skipped++;
      } else {
        fs.writeFileSync(targetPath, masterText, "utf8");
        result.instructions.copied++;
      }
    } catch (err) {
      result.instructions.errors.push(
        `${side}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // --- skills ---------------------------------------------------------------
  if (fs.existsSync(p.opencodeSkills)) {
    const names = readDirNames(p.opencodeSkills);
    for (const name of names) {
      const masterSkillPath = path.join(p.opencodeSkills, name);
      const linkPaths = [p.claudeSkills, p.codexSkills, p.agentsSkills];
      for (const root of linkPaths) {
        const linkPath = path.join(root, name);
        try {
          if (isSymlinkTo(linkPath, masterSkillPath)) {
            result.skills.skipped++;
          } else {
            symlinkDir(masterSkillPath, linkPath);
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
