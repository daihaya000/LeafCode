/**
 * Global agent definition files (`~/.config/opencode/agents/<name>.md`).
 *
 * The counterpart of `@/lib/project-agents` for the global config directory,
 * so the global settings tab can create/edit/delete definitions with the same
 * two-pane UI as project settings.
 *
 * Path safety mirrors the project module: names are restricted to a safe
 * charset, writes never follow a symlink, and the resolved target must stay
 * inside the *real* config directory — which matters here because the profiles
 * feature can make `~/.config/opencode` itself a junction/symlink.
 */

import fs from "node:fs";
import path from "node:path";
import { isAgentEnabled, setAgentDisabled } from "@/lib/agent-frontmatter";
import { ExtensionsError } from "./safe-move";
import {
  agentDefinitionDirs,
  homeRelative,
  opencodeConfigDir,
} from "./paths";

const MAX_AGENT_FILE_BYTES = 2 * 1024 * 1024;

/** Agent names are used to build file paths; restrict to a safe charset. */
export const SAFE_AGENT_NAME = /^[A-Za-z0-9._-]+$/;

export type AgentFileDto = {
  name: string;
  /** Display path (`~/.config/opencode/agents/<name>.md`). */
  displayPath: string;
  exists: boolean;
  content: string;
  enabled: boolean;
};

function realConfigDir(): string {
  const dir = opencodeConfigDir();
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return path.resolve(dir);
  }
}

function isWithinConfigDir(candidate: string): boolean {
  const relative = path.relative(realConfigDir(), candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function assertSafeName(name: string): void {
  if (!SAFE_AGENT_NAME.test(name)) {
    throw new ExtensionsError(
      "invalid-name",
      "エージェント名は英数字・ドット・アンダースコア・ハイフンのみ使用できます",
    );
  }
}

/** Path of the existing definition file, without following symlinks. */
function existingAgentFile(name: string): string | null {
  for (const dir of agentDefinitionDirs()) {
    const file = path.join(dir, `${name}.md`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function toDto(name: string, file: string, content: string): AgentFileDto {
  return {
    name,
    displayPath: homeRelative(file),
    exists: true,
    content,
    enabled: isAgentEnabled(content),
  };
}

/** Enumerate every `*.md` under the global agent directories. */
export function listAgentFiles(): AgentFileDto[] {
  const seen = new Set<string>();
  const files: AgentFileDto[] = [];
  for (const dir of agentDefinitionDirs()) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const name = entry.slice(0, -3);
      if (!SAFE_AGENT_NAME.test(name) || seen.has(name)) continue;
      const file = path.join(dir, entry);
      let stat: fs.Stats;
      let real: string;
      try {
        real = fs.realpathSync.native(file);
        stat = fs.statSync(real);
      } catch {
        continue;
      }
      if (!stat.isFile() || !isWithinConfigDir(real)) continue;
      seen.add(name);
      let content = "";
      if (stat.size <= MAX_AGENT_FILE_BYTES) {
        try {
          content = fs.readFileSync(real, "utf8");
        } catch {
          content = "";
        }
      }
      files.push(toDto(name, file, content));
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

export function readAgentFile(name: string): AgentFileDto {
  assertSafeName(name);
  const file = existingAgentFile(name);
  if (!file) {
    return {
      name,
      displayPath: homeRelative(
        path.join(agentDefinitionDirs()[0], `${name}.md`),
      ),
      exists: false,
      content: "",
      enabled: true,
    };
  }
  const real = fs.realpathSync.native(file);
  if (!isWithinConfigDir(real) || !fs.statSync(real).isFile()) {
    throw new ExtensionsError(
      "config",
      `エージェント「${name}」を安全に読み込めません`,
    );
  }
  if (fs.statSync(real).size > MAX_AGENT_FILE_BYTES) {
    throw new ExtensionsError(
      "config",
      `エージェント「${name}」は2MBを超えているため編集できません`,
    );
  }
  return toDto(name, file, fs.readFileSync(real, "utf8"));
}

export function writeAgentFile(name: string, content: string): AgentFileDto {
  assertSafeName(name);
  if (Buffer.byteLength(content, "utf8") > MAX_AGENT_FILE_BYTES) {
    throw new ExtensionsError(
      "invalid-name",
      "エージェント定義は2MB以内で指定してください",
    );
  }
  const target =
    existingAgentFile(name) ??
    path.join(agentDefinitionDirs()[0], `${name}.md`);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new ExtensionsError(
      "config",
      `エージェント「${name}」はシンボリックリンクのため編集できません`,
    );
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const realParent = fs.realpathSync.native(path.dirname(target));
  if (!isWithinConfigDir(realParent)) {
    throw new ExtensionsError(
      "config",
      `エージェント「${name}」の保存先が設定ディレクトリ外です`,
    );
  }
  fs.writeFileSync(target, content, "utf8");
  return toDto(name, target, content);
}

export function deleteAgentFile(name: string): void {
  assertSafeName(name);
  const file = existingAgentFile(name);
  if (!file) return;
  const real = fs.realpathSync.native(file);
  if (!isWithinConfigDir(real) || !fs.statSync(real).isFile()) return;
  fs.rmSync(real, { force: true });
}

/**
 * Enable/disable a file-backed global agent by flipping `disable` in its
 * frontmatter (see https://opencode.ai/docs/agents#disable).
 *
 * Preferred over the `opencode.jsonc` `agent.<name>.disable` route used for
 * built-ins: the definition file is the agent's own source of truth, so the
 * flag travels with it and no config entry is left behind after a delete.
 */
export function setAgentFileEnabled(
  name: string,
  enabled: boolean,
): AgentFileDto {
  const current = readAgentFile(name);
  if (!current.exists) {
    throw new ExtensionsError(
      "not-found",
      `エージェント「${name}」の定義ファイルが見つかりません`,
    );
  }
  if (current.enabled === enabled) return current;
  return writeAgentFile(name, setAgentDisabled(current.content, !enabled));
}
