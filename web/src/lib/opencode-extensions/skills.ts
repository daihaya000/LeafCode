import fs from "node:fs";
import path from "node:path";
import { ocServer } from "../oc-server";
import type { SkillDto } from "../extensions";
import { skillsDir, skillsDisabledDir } from "./paths";
import {
  ExtensionsError,
  assertValidEntryName,
  moveEntrySafe,
  resolveContainedPath,
} from "./safe-move";

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const MAX_DEPTH = 5;
const FRONTMATTER_READ_BYTES = 8192;
const DESCRIPTION_MAX = 300;

/**
 * Bounds for the recursive skills scan. A huge or pathological skills tree
 * (accidentally vendored hierarchies etc.) must not produce an unbounded
 * listing or unbounded I/O: when either bound is hit the scan stops early
 * and the result is flagged as truncated — a predictable, safe cutoff.
 */
export type SkillScanLimits = {
  /** Maximum number of skills collected per root. */
  maxSkills: number;
  /** Maximum number of directories inspected while walking. */
  maxScanDirs: number;
};

export const DEFAULT_SKILL_SCAN_LIMITS: SkillScanLimits = {
  maxSkills: 512,
  maxScanDirs: 4096,
};

export type SkillListResult = {
  skills: SkillDto[];
  /** True when a scan bound was hit and the listing may be incomplete. */
  truncated: boolean;
};

/**
 * Extract `description` from SKILL.md frontmatter. Handles plain values,
 * quoted values, and block scalars (`>`, `|` and their chomping variants).
 * Not a full YAML parser — just enough for skill metadata.
 */
export function parseFrontmatterDescription(
  markdown: string,
): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!block) return undefined;
  const lines = block[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^description\s*:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[1].trim();
    if (/^[>|][+-]?$/.test(value)) {
      // Block scalar: consume following indented (or blank) lines.
      const parts: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^\s/.test(lines[j]) || lines[j].trim() === "") {
          parts.push(lines[j].trim());
        } else {
          break;
        }
      }
      value = parts.filter(Boolean).join(" ");
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    value = value.trim();
    if (!value) return undefined;
    return value.length > DESCRIPTION_MAX
      ? `${value.slice(0, DESCRIPTION_MAX)}…`
      : value;
  }
  return undefined;
}

async function readSkillDescription(
  skillMdPath: string,
): Promise<string | undefined> {
  try {
    const handle = await fs.promises.open(skillMdPath, "r");
    try {
      const buf = Buffer.alloc(FRONTMATTER_READ_BYTES);
      const { bytesRead } = await handle.read(buf, 0, FRONTMATTER_READ_BYTES, 0);
      return parseFrontmatterDescription(buf.toString("utf8", 0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Per-root scan progress: directories inspected and whether a bound was hit. */
type ScanState = { dirs: number; truncated: boolean };

async function walkForSkills(
  root: string,
  dir: string,
  enabled: boolean,
  out: SkillDto[],
  depth: number,
  scan: ScanState,
  limits: SkillScanLimits,
): Promise<void> {
  if (depth > MAX_DEPTH || scan.truncated) return;
  scan.dirs += 1;
  if (scan.dirs > limits.maxScanDirs) {
    scan.truncated = true;
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return; // Missing root (e.g. no skills-disabled yet) → no skills.
  }
  for (const entry of entries) {
    if (scan.truncated) return;
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const dirPath = path.join(dir, entry.name);
    if (await isFile(path.join(dirPath, "SKILL.md"))) {
      if (out.length >= limits.maxSkills) {
        scan.truncated = true;
        return;
      }
      // Only direct children of the root can be moved safely; nested skills
      // are view-only (their id is the relative path).
      const direct = path.dirname(dirPath) === root;
      out.push({
        id: direct ? entry.name : path.relative(root, dirPath).split(path.sep).join("/"),
        name: entry.name,
        description: await readSkillDescription(path.join(dirPath, "SKILL.md")),
        enabled,
        toggleable: direct,
      });
    }
    await walkForSkills(root, dirPath, enabled, out, depth + 1, scan, limits);
  }
}

type EngineSkill = { name?: unknown; description?: unknown };

/** Descriptions from the engine's `/skill` response; empty when unavailable. */
async function fetchEngineSkillDescriptions(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const skills = await ocServer<EngineSkill[]>(null, "/skill", {
      timeoutMs: 3000,
    });
    if (Array.isArray(skills)) {
      for (const s of skills) {
        if (
          s &&
          typeof s.name === "string" &&
          typeof s.description === "string" &&
          s.description.trim()
        ) {
          map.set(s.name, s.description.trim());
        }
      }
    }
  } catch {
    // Engine down — frontmatter descriptions remain.
  }
  return map;
}

export async function listSkills(
  limits: SkillScanLimits = DEFAULT_SKILL_SCAN_LIMITS,
): Promise<SkillListResult> {
  const resolvedEnabled = path.resolve(skillsDir());
  const resolvedDisabled = path.resolve(skillsDisabledDir());
  const enabled: SkillDto[] = [];
  const disabled: SkillDto[] = [];
  const enabledScan: ScanState = { dirs: 0, truncated: false };
  const disabledScan: ScanState = { dirs: 0, truncated: false };
  await Promise.all([
    walkForSkills(resolvedEnabled, resolvedEnabled, true, enabled, 0, enabledScan, limits),
    walkForSkills(resolvedDisabled, resolvedDisabled, false, disabled, 0, disabledScan, limits),
  ]);
  const engineDescriptions = await fetchEngineSkillDescriptions();
  const all = [...enabled, ...disabled];
  for (const skill of all) {
    const fromEngine = engineDescriptions.get(skill.name);
    if (fromEngine) skill.description = fromEngine;
  }
  return {
    skills: all.sort((a, b) => a.name.localeCompare(b.name)),
    truncated: enabledScan.truncated || disabledScan.truncated,
  };
}

/**
 * Move `skills/<name>` ↔ `skills-disabled/<name>`.
 * The name is validated, re-contained under the expected root, and the
 * source must be a real skill directory (contains SKILL.md).
 */
export async function setSkillEnabled(
  name: string,
  enabled: boolean,
): Promise<void> {
  assertValidEntryName(name);
  const fromRoot = enabled ? skillsDisabledDir() : skillsDir();
  const toRoot = enabled ? skillsDir() : skillsDisabledDir();
  const from = resolveContainedPath(fromRoot, name);
  const to = resolveContainedPath(toRoot, name);
  if (!(await isFile(path.join(from, "SKILL.md")))) {
    throw new ExtensionsError("not-found", "スキルが見つかりません");
  }
  await moveEntrySafe(from, to, "dir");
}
