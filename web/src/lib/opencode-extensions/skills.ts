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

async function walkForSkills(
  root: string,
  dir: string,
  enabled: boolean,
  out: SkillDto[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return; // Missing root (e.g. no skills-disabled yet) → no skills.
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const dirPath = path.join(dir, entry.name);
    if (await isFile(path.join(dirPath, "SKILL.md"))) {
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
    await walkForSkills(root, dirPath, enabled, out, depth + 1);
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

export async function listSkills(): Promise<SkillDto[]> {
  const resolvedEnabled = path.resolve(skillsDir());
  const resolvedDisabled = path.resolve(skillsDisabledDir());
  const enabled: SkillDto[] = [];
  const disabled: SkillDto[] = [];
  await Promise.all([
    walkForSkills(resolvedEnabled, resolvedEnabled, true, enabled, 0),
    walkForSkills(resolvedDisabled, resolvedDisabled, false, disabled, 0),
  ]);
  const engineDescriptions = await fetchEngineSkillDescriptions();
  const all = [...enabled, ...disabled];
  for (const skill of all) {
    const fromEngine = engineDescriptions.get(skill.name);
    if (fromEngine) skill.description = fromEngine;
  }
  return all.sort((a, b) => a.name.localeCompare(b.name));
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
