import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "../paths";

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
