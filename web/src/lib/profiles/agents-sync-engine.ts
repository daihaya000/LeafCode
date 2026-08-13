/**
 * agents-sync engine — global AGENTS.md/skills -> claude/codex/cursor/opencode.
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
 *   - ~/.cursor/AGENTS.md             (copied from AGENTS.md)
 *   - ~/.claude/skills/<name>/        -> symlink to ~/.config/opencode/skills/<name>
 *   - ~/.codex/skills/<name>/        -> symlink to ~/.config/opencode/skills/<name>
 *   - ~/.agents/skills/<name>/       -> symlink to ~/.config/opencode/skills/<name>
 *   - ~/.cursor/skills/<name>/       -> symlink to ~/.config/opencode/skills/<name>
 *
 * Hermes Agent (Nous Research) reads skills from external directories, so no
 * symlinks are created under ~/.hermes/skills/. Instead, ~/.hermes/config.yaml
 * gets `skills.external_dirs` pointing at ~/.agents/skills, which Hermes scans
 * directly alongside its own directory.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();

/** External skill directory registered in Hermes config.yaml. */
const HERMES_EXTERNAL_DIR = "~/.agents/skills";

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
    cursor: { path: string; status: AgentsSyncItemStatus };
  };
  skills: {
    opencodeRoot: { path: string; exists: boolean; count: number };
    mirrors: Record<string, { path: string; status: AgentsSyncItemStatus }>;
    hermes: { path: string; status: AgentsSyncItemStatus };
  };
};

export type AgentsSyncResult = {
  ok: boolean;
  instructions: { copied: number; skipped: number; errors: string[] };
  skills: { created: number; skipped: number; errors: string[] };
  hermes: { updated: number; skipped: number; errors: string[] };
  error?: string;
};

export function agentsSyncPaths() {
  return {
    masterMd: path.join(HOME, ".config", "opencode", "AGENTS.md"),
    claudeMd: path.join(HOME, ".claude", "CLAUDE.md"),
    codexMd: path.join(HOME, ".codex", "AGENTS.md"),
    cursorMd: path.join(HOME, ".cursor", "AGENTS.md"),
    opencodeSkills: path.join(HOME, ".config", "opencode", "skills"),
    claudeSkills: path.join(HOME, ".claude", "skills"),
    codexSkills: path.join(HOME, ".codex", "skills"),
    agentsSkills: path.join(HOME, ".agents", "skills"),
    cursorSkills: path.join(HOME, ".cursor", "skills"),
    hermesConfig: path.join(HOME, ".hermes", "config.yaml"),
  };
}

// Local alias so the rest of this file reads the same as before the export.
const paths = agentsSyncPaths;

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
  const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new Error("sync target exists and is not a symbolic link");
    }
    fs.rmSync(linkPath, { force: true });
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

/** Strip surrounding quotes/brackets from a YAML flow-list item. */
function normalizeExternalDirValue(value: string): string {
  let t = value.trim();
  if (t.startsWith("[") || t.startsWith("{")) t = t.slice(1).trim();
  if (t.endsWith("]") || t.endsWith("}")) t = t.slice(0, -1).trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * True when the top-level `skills:` section of a Hermes config.yaml already
 * lists HERMES_EXTERNAL_DIR under `external_dirs:` (block or inline form).
 */
function hermesExternalDirsConfigured(configText: string): boolean {
  const lines = configText.split(/\r?\n/);
  let inSkills = false;
  let inExternalDirs = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\S/.test(line)) {
      inSkills = /^skills\s*:/.test(trimmed);
      inExternalDirs = false;
      continue;
    }
    if (!inSkills) continue;
    if (/^external_dirs\s*:/.test(trimmed)) {
      inExternalDirs = true;
      const rest = trimmed.replace(/^external_dirs\s*:\s*/, "");
      if (rest && rest !== "[]" && !rest.startsWith("#")) {
        for (const part of rest.split(",")) {
          if (normalizeExternalDirValue(part) === HERMES_EXTERNAL_DIR) return true;
        }
      }
      continue;
    }
    if (!inExternalDirs) continue;
    if (trimmed.startsWith("-")) {
      if (normalizeExternalDirValue(trimmed.slice(1)) === HERMES_EXTERNAL_DIR) {
        return true;
      }
    } else if (/^[\w.-]+\s*:/.test(trimmed) && !trimmed.startsWith("#")) {
      inExternalDirs = false;
    }
  }
  return false;
}

/**
 * Add HERMES_EXTERNAL_DIR to `skills.external_dirs` of a Hermes config.yaml,
 * preserving all other lines. Throws when the existing `skills:` section is
 * inline (`skills: {}`) and cannot be edited safely.
 */
function mergeHermesExternalDirs(configText: string): string {
  const lines = configText.split(/\r?\n/);
  let skillsIndex = -1;
  let externalDirsIndex = -1;
  let lastExternalDirItem = -1;
  let inlineSkillsRest = "";
  let inSkills = false;
  let inExternalDirs = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^\S/.test(lines[i])) {
      inSkills = /^skills\s*:/.test(trimmed);
      if (inSkills) {
        skillsIndex = i;
        inlineSkillsRest = trimmed.replace(/^skills\s*:\s*/, "");
      }
      inExternalDirs = false;
      continue;
    }
    if (!inSkills) continue;
    if (/^external_dirs\s*:/.test(trimmed)) {
      inExternalDirs = true;
      externalDirsIndex = i;
      const rest = trimmed.replace(/^external_dirs\s*:\s*/, "");
      if (rest && rest !== "[]" && !rest.startsWith("#")) {
        if (rest.endsWith("]")) {
          // inline list: `external_dirs: [a, b]` -> append inside the brackets
          const insertAt = lines[i].lastIndexOf("]");
          lines[i] =
            lines[i].slice(0, insertAt) + ", " + HERMES_EXTERNAL_DIR + "]";
          return lines.join("\n");
        }
        throw new Error("existing inline skills.external_dirs cannot be merged");
      }
      if (rest === "[]") {
        // empty flow list: `external_dirs: []` -> switch to block list
        lines[i] = lines[i].slice(0, lines[i].indexOf("external_dirs") + "external_dirs".length) + ":";
        lines.splice(i + 1, 0, "    - " + HERMES_EXTERNAL_DIR);
        return lines.join("\n");
      }
      continue;
    }
    if (!inExternalDirs) continue;
    if (trimmed.startsWith("-")) {
      lastExternalDirItem = i;
    } else if (/^[\w.-]+\s*:/.test(trimmed) && !trimmed.startsWith("#")) {
      inExternalDirs = false;
    }
  }

  if (skillsIndex >= 0) {
    if (inlineSkillsRest && inlineSkillsRest !== "{}" && !inlineSkillsRest.startsWith("#")) {
      throw new Error("existing inline skills section cannot be merged");
    }
    const insertAfter = lastExternalDirItem >= 0 ? lastExternalDirItem : externalDirsIndex;
    if (externalDirsIndex >= 0) {
      lines.splice(insertAfter + 1, 0, "    - " + HERMES_EXTERNAL_DIR);
    } else {
      lines.splice(skillsIndex + 1, 0, "  external_dirs:", "    - " + HERMES_EXTERNAL_DIR);
    }
    return lines.join("\n");
  }

  const tail = configText === "" || configText.endsWith("\n") ? "" : "\n";
  return (
    configText +
    tail +
    "skills:\n" +
    "  external_dirs:\n" +
    "    - " +
    HERMES_EXTERNAL_DIR +
    "\n"
  );
}

function hermesConfigStatus(): AgentsSyncItemStatus {
  const p = paths();
  const text = readIfExists(p.hermesConfig);
  if (text === null) {
    return {
      kind: "wouldChange",
      message: "config.yaml に skills.external_dirs を追加予定",
    };
  }
  if (hermesExternalDirsConfigured(text)) {
    return {
      kind: "ok",
      message: `external_dirs に ${HERMES_EXTERNAL_DIR} が設定済み`,
    };
  }
  return {
    kind: "wouldChange",
    message: `external_dirs に ${HERMES_EXTERNAL_DIR} を追加予定`,
  };
}

function instructionsStatus(): AgentsSyncStatus["instructions"] {
  const p = paths();
  const masterExists = fs.existsSync(p.masterMd);
  return {
    master: { path: p.masterMd, exists: masterExists },
    claude: { path: p.claudeMd, status: compareStatus(p.masterMd, p.claudeMd) },
    codex: { path: p.codexMd, status: compareStatus(p.masterMd, p.codexMd) },
    cursor: { path: p.cursorMd, status: compareStatus(p.masterMd, p.cursorMd) },
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
      cursor: path.join(p.cursorSkills, name),
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
    hermes: { path: p.hermesConfig, status: hermesConfigStatus() },
  };
}

export function readAgentsSyncStatus(): AgentsSyncStatus {
  return {
    instructions: instructionsStatus(),
    skills: skillsStatus(),
  };
}

export function readMasterAgents(): { path: string; exists: boolean; content: string } {
  const masterPath = paths().masterMd;
  const content = readIfExists(masterPath);
  return { path: masterPath, exists: content !== null, content: content ?? "" };
}

export function writeMasterAgents(content: string): { path: string } {
  const masterPath = paths().masterMd;
  mkdirp(path.dirname(masterPath));
  fs.writeFileSync(masterPath, content, "utf8");
  return { path: masterPath };
}

export function applyAgentsSync(): AgentsSyncResult {
  const p = paths();
  const result: AgentsSyncResult = {
    ok: true,
    instructions: { copied: 0, skipped: 0, errors: [] },
    skills: { created: 0, skipped: 0, errors: [] },
    hermes: { updated: 0, skipped: 0, errors: [] },
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
    cursor: p.cursorMd,
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
      const linkRoots: Array<[string, string]> = [
        ["claude", p.claudeSkills],
        ["codex", p.codexSkills],
        ["agents", p.agentsSkills],
        ["cursor", p.cursorSkills],
      ];
      for (const [side, root] of linkRoots) {
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
            `${side}/${name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  // --- hermes external_dirs ------------------------------------------------
  try {
    const current = readIfExists(p.hermesConfig);
    if (current !== null && hermesExternalDirsConfigured(current)) {
      result.hermes.skipped++;
    } else {
      mkdirp(path.dirname(p.hermesConfig));
      const next = mergeHermesExternalDirs(current ?? "");
      fs.writeFileSync(p.hermesConfig, next, "utf8");
      result.hermes.updated++;
    }
  } catch (err) {
    result.hermes.errors.push(
      `hermes: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (
    result.instructions.errors.length ||
    result.skills.errors.length ||
    result.hermes.errors.length
  ) {
    result.ok = false;
  }
  return result;
}
