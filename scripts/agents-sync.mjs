#!/usr/bin/env node
/**
 * agents-sync.mjs (CLI entry point)
 *
 * Global CLAUDE.md/skills -> codex/opencode/agents mirrors.
 * Mirrors web/src/lib/profiles/agents-sync-engine.ts behavior.
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
  masterMd: path.join(HOME, ".claude", "CLAUDE.md"),
  codexMd: path.join(HOME, ".codex", "AGENTS.md"),
  opencodeConfig: path.join(HOME, ".config", "opencode", "opencode.jsonc"),
  claudeSkills: path.join(HOME, ".claude", "skills"),
  codexSkills: path.join(HOME, ".codex", "skills"),
  opencodeSkills: path.join(HOME, ".config", "opencode", "skills"),
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

function writeJsonc(p, value) {
  fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
    const current = readIfExists(PATHS.codexMd);
    const master = readIfExists(PATHS.masterMd);
    status.instructions.push({
      target: "codex",
      path: PATHS.codexMd,
      wouldChange: current !== master,
      message: current === master ? "contents match" : "will copy from master",
    });

    if (!fs.existsSync(PATHS.opencodeConfig)) {
      status.instructions.push({
        target: "opencode",
        path: PATHS.opencodeConfig,
        wouldChange: false,
        message: "config not found",
      });
    } else {
      try {
        const cfg = readJsonc(PATHS.opencodeConfig);
        const instructions = Array.isArray(cfg.instructions) ? cfg.instructions : [];
        const resolved = instructions.map((i) => path.resolve(path.dirname(PATHS.opencodeConfig), i));
        const hasIt = resolved.includes(path.resolve(PATHS.masterMd));
        status.instructions.push({
          target: "opencode",
          path: PATHS.opencodeConfig,
          wouldChange: !hasIt,
          message: hasIt ? "CLAUDE.md already in instructions" : "will add CLAUDE.md to instructions",
        });
      } catch (err) {
        status.instructions.push({
          target: "opencode",
          path: PATHS.opencodeConfig,
          wouldChange: false,
          message: `error reading config: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  if (fs.existsSync(PATHS.claudeSkills)) {
    const names = readDirNames(PATHS.claudeSkills);
    for (const name of names) {
      const claudePath = path.join(PATHS.claudeSkills, name);
      const mirrors = [
        ["codex", path.join(PATHS.codexSkills, name)],
        ["opencode", path.join(PATHS.opencodeSkills, name)],
        ["agents", path.join(PATHS.agentsSkills, name)],
      ];
      for (const [side, linkPath] of mirrors) {
        if (isSymlinkTo(linkPath, claudePath)) {
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

  try {
    mkdirp(path.dirname(PATHS.codexMd));
    const current = readIfExists(PATHS.codexMd);
    const master = fs.readFileSync(PATHS.masterMd, "utf8");
    if (current === master) {
      result.instructions.skipped++;
      console.log("[codex] already in sync");
    } else {
      fs.writeFileSync(PATHS.codexMd, master, "utf8");
      result.instructions.copied++;
      console.log("[codex] copied CLAUDE.md");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.instructions.errors.push(`codex: ${msg}`);
    console.error(`[codex] error: ${msg}`);
  }

  if (fs.existsSync(PATHS.opencodeConfig)) {
    try {
      const cfg = readJsonc(PATHS.opencodeConfig);
      const instructions = Array.isArray(cfg.instructions) ? cfg.instructions : [];
      const resolved = instructions.map((i) => path.resolve(path.dirname(PATHS.opencodeConfig), i));
      if (!resolved.includes(path.resolve(PATHS.masterMd))) {
        instructions.push(PATHS.masterMd);
        cfg.instructions = instructions;
        writeJsonc(PATHS.opencodeConfig, cfg);
        result.instructions.copied++;
        console.log("[opencode] added CLAUDE.md to instructions");
      } else {
        result.instructions.skipped++;
        console.log("[opencode] CLAUDE.md already in instructions");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.instructions.errors.push(`opencode: ${msg}`);
      console.error(`[opencode] error: ${msg}`);
    }
  }

  if (fs.existsSync(PATHS.claudeSkills)) {
    const names = readDirNames(PATHS.claudeSkills);
    for (const name of names) {
      const claudePath = path.join(PATHS.claudeSkills, name);
      const mirrors = [
        ["codex", PATHS.codexSkills],
        ["opencode", PATHS.opencodeSkills],
        ["agents", PATHS.agentsSkills],
      ];
      for (const [side, root] of mirrors) {
        const linkPath = path.join(root, name);
        try {
          if (isSymlinkTo(linkPath, claudePath)) {
            result.skills.skipped++;
          } else {
            symlinkDir(claudePath, linkPath);
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
