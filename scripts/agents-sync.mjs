#!/usr/bin/env node
/**
 * agents-sync.mjs (CLI entry point)
 *
 * Global AGENTS.md/skills -> claude/codex/agents mirrors.
 * Mirrors web/src/lib/profiles/agents-sync-engine.ts behavior.
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
 *
 * Usage: node scripts/agents-sync.mjs [--check]
 *   --check  dry-run; print status and exit non-zero if changes would be made
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const dryRun = process.argv.includes("--check");

const PATHS = {
  masterMd: path.join(HOME, ".config", "opencode", "AGENTS.md"),
  claudeMd: path.join(HOME, ".claude", "CLAUDE.md"),
  codexMd: path.join(HOME, ".codex", "AGENTS.md"),
  opencodeSkills: path.join(HOME, ".config", "opencode", "skills"),
  claudeSkills: path.join(HOME, ".claude", "skills"),
  codexSkills: path.join(HOME, ".codex", "skills"),
  agentsSkills: path.join(HOME, ".agents", "skills"),
};

function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function stripJsonc(text) {
  let out = "";
  let i = 0;
  let inStr = false;
  let strCh = "";
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") {
        out += c + (text[i + 1] ?? "");
        i += 2;
        continue;
      }
      out += c;
      if (c === strCh) inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      strCh = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function readJsonc(p) {
  return JSON.parse(stripJsonc(readIfExists(p) ?? "{}"));
}

function readDirNames(p) {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function isSymlinkTo(linkPath, target) {
  try {
    const stat = fs.lstatSync(linkPath);
    if (!stat.isSymbolicLink()) return false;
    const cur = fs.readlinkSync(linkPath);
    return path.resolve(linkPath, cur) === path.resolve(target);
  } catch {
    return false;
  }
}

function symlinkDir(target, linkPath) {
  mkdirp(path.dirname(linkPath));
  if (fs.existsSync(linkPath) || fs.lstatSync(linkPath, { throwIfNoEntry: false })) {
    fs.rmSync(linkPath, { recursive: true, force: true });
  }
  if (process.platform === "win32") {
    try {
      fs.symlinkSync(path.resolve(target), linkPath, "junction");
      return;
    } catch {
      // fall through
    }
  }
  fs.symlinkSync(target, linkPath, "dir");
}

function plan() {
  const masterExists = fs.existsSync(PATHS.masterMd);
  const status = {
    instructions: [],
    skills: [],
  };

  if (!masterExists) {
    status.instructions.push({ target: "master", message: "missing", wouldChange: true });
  } else {
    for (const [side, mirrorPath] of Object.entries({
      claude: PATHS.claudeMd,
      codex: PATHS.codexMd,
    })) {
      const current = readIfExists(mirrorPath);
      const master = readIfExists(PATHS.masterMd);
      status.instructions.push({
        target: side,
        path: mirrorPath,
        wouldChange: current !== master,
        message: current === master ? "contents match" : "will copy from master",
      });
    }
  }

  if (fs.existsSync(PATHS.opencodeSkills)) {
    const names = readDirNames(PATHS.opencodeSkills);
    for (const name of names) {
      const masterPath = path.join(PATHS.opencodeSkills, name);
      const mirrors = [
        ["claude", path.join(PATHS.claudeSkills, name)],
        ["codex", path.join(PATHS.codexSkills, name)],
        ["agents", path.join(PATHS.agentsSkills, name)],
      ];
      for (const [side, linkPath] of mirrors) {
        if (isSymlinkTo(linkPath, masterPath)) {
          status.skills.push({ name, side, path: linkPath, wouldChange: false, message: "symlink correct" });
        } else if (fs.existsSync(linkPath)) {
          status.skills.push({
            name,
            side,
            path: linkPath,
            wouldChange: false,
            message: "exists but is not the correct symlink (blocked)",
          });
        } else {
          status.skills.push({
            name,
            side,
            path: linkPath,
            wouldChange: true,
            message: "will create symlink",
          });
        }
      }
    }
  }

  return status;
}

function apply() {
  const result = { instructions: { copied: 0, skipped: 0, errors: [] }, skills: { created: 0, skipped: 0, errors: [] } };

  if (!fs.existsSync(PATHS.masterMd)) {
    console.error(`[agents-sync] master not found: ${PATHS.masterMd}`);
    process.exit(2);
  }

  const masterText = fs.readFileSync(PATHS.masterMd, "utf8");
  for (const [side, targetPath] of Object.entries({
    claude: PATHS.claudeMd,
    codex: PATHS.codexMd,
  })) {
    try {
      mkdirp(path.dirname(targetPath));
      const current = readIfExists(targetPath);
      if (current === masterText) {
        result.instructions.skipped++;
        console.log(`[${side}] already in sync`);
      } else {
        fs.writeFileSync(targetPath, masterText, "utf8");
        result.instructions.copied++;
        console.log(`[${side}] copied AGENTS.md`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.instructions.errors.push(`${side}: ${msg}`);
      console.error(`[${side}] error: ${msg}`);
    }
  }

  if (fs.existsSync(PATHS.opencodeSkills)) {
    const names = readDirNames(PATHS.opencodeSkills);
    for (const name of names) {
      const masterPath = path.join(PATHS.opencodeSkills, name);
      const mirrors = [
        ["claude", PATHS.claudeSkills],
        ["codex", PATHS.codexSkills],
        ["agents", PATHS.agentsSkills],
      ];
      for (const [side, root] of mirrors) {
        const linkPath = path.join(root, name);
        try {
          if (isSymlinkTo(linkPath, masterPath)) {
            result.skills.skipped++;
          } else {
            symlinkDir(masterPath, linkPath);
            result.skills.created++;
            console.log(`[skills] ${side}/${name} -> symlink created`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.skills.errors.push(`${side}/${name}: ${msg}`);
          console.error(`[skills] ${side}/${name}: ${msg}`);
        }
      }
    }
  }

  return result;
}

if (dryRun) {
  const status = plan();
  let wouldChange = 0;
  for (const item of status.instructions) {
    console.log(`[instructions:${item.target}] ${item.message}`);
    if (item.wouldChange) wouldChange++;
  }
  for (const item of status.skills) {
    console.log(`[skills:${item.side}:${item.name}] ${item.message}`);
    if (item.wouldChange) wouldChange++;
  }
  console.log(`[agents-sync] plan: ${wouldChange} change(s) would be made`);
  process.exit(wouldChange > 0 ? 1 : 0);
}

const result = apply();
const errors = result.instructions.errors.length + result.skills.errors.length;
const changes = result.instructions.copied + result.skills.created;
console.log(`[agents-sync] done (${changes} copied/created, ${errors} error(s))`);
process.exit(errors > 0 ? 2 : 0);
