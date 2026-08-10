/**
 * Project-scoped subagent definition files.
 *
 * OpenCode looks up agent definitions under `<project>/.opencode/agent` and
 * `<project>/.opencode/agents` (see opencode-extensions/paths.ts). This module
 * enumerates, reads, and persists the markdown definitions for a specific
 * project root, with the same path-safety guarantees as the fixed setting
 * files (no traversal, no symlink escape, 2 MiB cap).
 */

import fs from "node:fs";
import path from "node:path";

const MAX_AGENT_FILE_BYTES = 2 * 1024 * 1024;

/** Agent names are used to build file paths; restrict to a safe charset. */
export const SAFE_AGENT_NAME = /^[A-Za-z0-9._-]+$/;

/** Directories holding project-scoped agent definition files, in lookup order. */
export function projectAgentDirs(root: string): string[] {
  const base = path.join(root, ".opencode");
  return [path.join(base, "agents"), path.join(base, "agent")];
}

export type ProjectAgentDto = {
  name: string;
  /** Absolute file path resolved under the project root. */
  path: string;
  /** Display path relative to the project root. */
  relativePath: string;
  exists: boolean;
  content: string;
};

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resolveAgentFile(root: string, name: string): string {
  for (const dir of projectAgentDirs(root)) {
    const file = path.join(dir, `${name}.md`);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const real = fs.realpathSync.native(file);
      if (isWithinRoot(root, real)) return real;
    }
  }
  return path.join(projectAgentDirs(root)[0], `${name}.md`);
}

/** Enumerate every `*.md` under the project agent directories. */
export function listProjectAgents(root: string): ProjectAgentDto[] {
  const seen = new Set<string>();
  const agents: ProjectAgentDto[] = [];
  for (const dir of projectAgentDirs(root)) {
    if (!fs.existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const name = entry.slice(0, -3);
      if (!SAFE_AGENT_NAME.test(name)) continue;
      const file = path.join(dir, entry);
      const real = fs.realpathSync.native(file);
      if (!isWithinRoot(root, real) || !fs.statSync(real).isFile()) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      const size = fs.statSync(real).size;
      let content = "";
      if (size <= MAX_AGENT_FILE_BYTES) {
        try {
          content = fs.readFileSync(real, "utf8");
        } catch {
          content = "";
        }
      }
      agents.push({
        name,
        path: real,
        relativePath: path.relative(root, real).split(path.sep).join("/"),
        exists: true,
        content,
      });
    }
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return agents;
}

export function readProjectAgent(root: string, name: string): ProjectAgentDto {
  if (!SAFE_AGENT_NAME.test(name)) {
    throw new Error("エージェント名は英数字・ドット・アンダースコア・ハイフンのみ使用できます");
  }
  const file = resolveAgentFile(root, name);
  if (!fs.existsSync(file)) {
    return {
      name,
      path: file,
      relativePath: path.relative(root, file).split(path.sep).join("/"),
      exists: false,
      content: "",
    };
  }
  const real = fs.realpathSync.native(file);
  if (!isWithinRoot(root, real) || !fs.statSync(real).isFile()) {
    throw new Error(`エージェント「${name}」を安全に読み込めません`);
  }
  const size = fs.statSync(real).size;
  if (size > MAX_AGENT_FILE_BYTES) {
    throw new Error(`エージェント「${name}」は2MBを超えているため編集できません`);
  }
  return {
    name,
    path: real,
    relativePath: path.relative(root, real).split(path.sep).join("/"),
    exists: true,
    content: fs.readFileSync(real, "utf8"),
  };
}

export function writeProjectAgent(root: string, name: string, content: string): ProjectAgentDto {
  if (!SAFE_AGENT_NAME.test(name)) {
    throw new Error("エージェント名は英数字・ドット・アンダースコア・ハイフンのみ使用できます");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_AGENT_FILE_BYTES) {
    throw new Error("エージェント定義は2MB以内で指定してください");
  }
  const target = path.join(projectAgentDirs(root)[0], `${name}.md`);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`エージェント「${name}」はシンボリックリンクのため編集できません`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const realParent = fs.realpathSync.native(path.dirname(target));
  if (!isWithinRoot(root, realParent)) {
    throw new Error(`エージェント「${name}」の保存先がプロジェクト外です`);
  }
  fs.writeFileSync(target, content, "utf8");
  return {
    name,
    path: target,
    relativePath: path.relative(root, target).split(path.sep).join("/"),
    exists: true,
    content,
  };
}

export function deleteProjectAgent(root: string, name: string): void {
  if (!SAFE_AGENT_NAME.test(name)) {
    throw new Error("エージェント名は英数字・ドット・アンダースコア・ハイフンのみ使用できます");
  }
  const file = resolveAgentFile(root, name);
  if (!fs.existsSync(file)) return;
  const real = fs.realpathSync.native(file);
  if (!isWithinRoot(root, real) || !fs.statSync(real).isFile()) return;
  fs.rmSync(real, { force: true });
}