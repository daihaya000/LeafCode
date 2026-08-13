#!/usr/bin/env node
/**
 * sync-profiles.mjs (CLI entry point)
 *
 * opencode.jsonc (master) -> codex config.toml / claude settings.json
 *
 * Master:  ~/.config/opencode/opencode.jsonc
 * Targets: ~/.codex/config.toml        (overwrite only [mcp_servers.*] tables)
 *          ~/.claude/settings.json      (overwrite only mcpServers key)
 *
 * Product-specific fields (codex plugins/projects, claude permissions/theme)
 * are preserved. Only the MCP server layer is synchronized.
 *
 * Usage: node scripts/sync-profiles.mjs [--check]
 *   --check  dry-run; print plan and exit non-zero if changes would be made
 *
 * Note: The WebUI API endpoint (web/src/app/api/profiles/sync/route.ts) shares
 * the same logic via web/src/lib/profiles/sync-engine.ts. Keep both in sync
 * when changing behavior.
 */
import { readFileSync, writeFileSync, existsSync, lstatSync, readlinkSync, rmdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readJsonc, stripJsonc } from "./lib/jsonc.mjs";
import { envValueToClaude, envValueToCodex, filterEnv, isEnvRef, opencodeMcpToClaude, opencodeMcpToCodex, replaceCodexMcpTables, tomlArray, tomlString, buildTargets } from "./lib/sync-utils.mjs";
import { applySync, planSync } from "./lib/sync-engine.mjs";

const HOME = homedir();
const OPENCODE_CONFIG_LINK = path.join(HOME, ".config", "opencode");
const OPENCODE_CONFIG_DEFAULT = path.join(OPENCODE_CONFIG_LINK, "opencode.jsonc");
const CODEX_CONFIG = path.join(HOME, ".codex", "config.toml");
const CLAUDE_SETTINGS = path.join(HOME, ".claude", "settings.json");
const CURSOR_CONFIG = path.join(HOME, ".cursor", "mcp.json");


const dryRun = process.argv.includes("--check");

/**
 * Determine the active opencode config file by following the global config link
 * (`~/.config/opencode`). Mirrors web/src/lib/profiles/sync-engine.ts.
 */
function resolveActiveOpencodeConfigPath() {
  try {
    const stat = lstatSync(OPENCODE_CONFIG_LINK);
    if (stat.isSymbolicLink()) {
      const raw = readlinkSync(OPENCODE_CONFIG_LINK);
      const target = path.isAbsolute(raw)
        ? path.resolve(raw)
        : path.resolve(path.dirname(OPENCODE_CONFIG_LINK), raw);
      return path.join(target, "opencode.jsonc");
    }
  } catch {
    /* fall back to default */
  }
  return OPENCODE_CONFIG_DEFAULT;
}

const OPENCODE_CONFIG = resolveActiveOpencodeConfigPath();
const CLI_PATHS = {
  opencode: OPENCODE_CONFIG,
  codex: CODEX_CONFIG,
  claude: CLAUDE_SETTINGS,
  cursor: CURSOR_CONFIG,
};

/**
 * Parse `~/.claude/settings.json`. Unlike the master `opencode.jsonc`, it must
 * be strict JSON; a corrupted file used to crash the script with a raw
 * stack trace. Returns null and a user-facing message instead.
 */
if (dryRun) {
  const plan = planSync({ paths: CLI_PATHS });
  if (!plan.ok) {
    console.error(`[sync-profiles] ${plan.error}`);
    process.exit(2);
  }
  let wouldChange = 0;
  for (const [name, t] of Object.entries(plan.targets)) {
    console.log(`[${name}] ${t.message}`);
    if (t.wouldChange) wouldChange++;
  }
  console.log(`[sync-profiles] plan: ${plan.masterServers.length} master server(s), ${wouldChange} file(s) would change`);
  if (wouldChange > 0) process.exit(1);
  process.exit(0);
}

const result = applySync({ paths: CLI_PATHS });
if (!result.ok) {
  console.error(`[sync-profiles] ${result.error}`);
  process.exit(2);
}
console.log(`[sync-profiles] master: ${OPENCODE_CONFIG}`);
for (const [name, t] of Object.entries(result.targets)) {
  console.log(`[${name}] ${t.message}`);
}
console.log(`[sync-profiles] done (${result.changedFiles} file(s) updated)`);
