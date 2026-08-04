import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "../paths";
import { installationRoot } from "../install-root";

/**
 * Global OpenCode config directory (`~/.config/opencode`).
 *
 * `OPENCODE_CONFIG_DIR` overrides the location for tests and unusual setups;
 * read dynamically (not at module load) so tests can point it at temp dirs.
 */
export function opencodeConfigDir(): string {
  const override = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".config", "opencode");
}

export function skillsDir(): string {
  return path.join(opencodeConfigDir(), "skills");
}

export function skillsDisabledDir(): string {
  return path.join(opencodeConfigDir(), "skills-disabled");
}

export function pluginDir(): string {
  return path.join(opencodeConfigDir(), "plugin");
}

export function pluginDisabledDir(): string {
  return path.join(opencodeConfigDir(), "plugin-disabled");
}

/**
 * Directories holding agent definition markdown files, in lookup order.
 * OpenCode reads `agent/`; this config repo uses the plural `agents/`, so both
 * are probed.
 */
export function agentDefinitionDirs(): string[] {
  const dir = opencodeConfigDir();
  return [path.join(dir, "agents"), path.join(dir, "agent")];
}

/**
 * Global config file path, preferring `opencode.jsonc`.
 * Returns the `.json` path when neither exists so callers can raise a
 * consistent "not found" error on read.
 */
export function opencodeConfigFilePath(): string {
  const dir = opencodeConfigDir();
  const jsonc = path.join(dir, "opencode.jsonc");
  if (fs.existsSync(jsonc)) return jsonc;
  return path.join(dir, "opencode.json");
}

/**
 * WebUI-local state for disabled configured plugins. Lives in the
 * machine-local data dir (never in the repo or the OpenCode config dir),
 * because "a configured plugin is disabled" is a WebUI-managed fact, not an
 * OpenCode config value.
 */
export function extensionsStatePath(): string {
  return path.join(dataDir(), "opencode-extensions.json");
}

/**
 * Root of the project the managed OpenCode engine runs against (the
 * directory it was spawned with as `cwd`, i.e. this WebUI's own
 * installation root — see `host/src/index.js`'s `REPO_ROOT`).
 *
 * `OPENCODE_WEBUI_PROJECT_ROOT` overrides the location for tests; read
 * dynamically so tests can point it at temp dirs without touching the real
 * repo checkout.
 */
export function projectRoot(): string {
  const override = process.env.OPENCODE_WEBUI_PROJECT_ROOT?.trim();
  if (override) return path.resolve(override);
  return installationRoot();
}

/**
 * Directories holding *project-scoped* agent definition markdown files, in
 * lookup order. Mirrors `agentDefinitionDirs()` but rooted at the project
 * (`.opencode/agents/`, falling back to the singular `.opencode/agent/` for
 * backwards compatibility — see https://opencode.ai/docs/agents).
 */
export function projectAgentDefinitionDirs(): string[] {
  const dir = path.join(projectRoot(), ".opencode");
  return [path.join(dir, "agents"), path.join(dir, "agent")];
}

/**
 * Project-level config file path (`opencode.jsonc`/`opencode.json` at the
 * project root), preferring `.jsonc`. Returns `null` when neither exists —
 * unlike `opencodeConfigFilePath()`, most projects have no local config, and
 * callers here only use the result for display, not for raising "not found".
 */
export function projectConfigFilePath(): string | null {
  const dir = projectRoot();
  const jsonc = path.join(dir, "opencode.jsonc");
  if (fs.existsSync(jsonc)) return jsonc;
  const json = path.join(dir, "opencode.json");
  if (fs.existsSync(json)) return json;
  return null;
}
