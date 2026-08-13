/**
 * Profile sync engine — opencode.jsonc (master) -> codex/claude.
 *
 * Exported functions are used by:
 *   - scripts/sync-profiles.mjs  (CLI entry point)
 *   - web/src/app/api/profiles/sync/route.ts  (WebUI endpoint)
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readLinkState } from "./link";
import { globalConfigLinkPath } from "./paths";
import { stripJsonc } from "./jsonc";
import { type McpDefinition } from "../../../../scripts/lib/sync-utils.mjs";
import {
  applySync as sharedApplySync,
  planSync as sharedPlanSync,
  type SyncApplyResult,
  type SyncPlan,
} from "../../../../scripts/lib/sync-engine.mjs";

const HOME = homedir();

type OpendcodeConfig = {
  mcp?: Record<string, McpDefinition>;
};

// Browser Bridge is bundled with WebUI and its absolute local path is not
// valid in distributed Cursor/Claude/Codex profiles.
const NON_DISTRIBUTABLE_MCP_SERVERS = new Set(["browser-bridge"]);

export function isDistributableMcpServer(name: string): boolean {
  return !NON_DISTRIBUTABLE_MCP_SERVERS.has(name);
}

export function profilePaths() {
  return {
    opencode: resolveActiveProfileConfigPath(),
    codex: path.join(HOME, ".codex", "config.toml"),
    claude: path.join(HOME, ".claude", "settings.json"),
    cursor: path.join(HOME, ".cursor", "mcp.json"),
  };
}

/**
 * Determine the active opencode config directory by following the global
 * config link (`~/.config/opencode`). If it is a link/junction, the link
 * target is the active profile directory; otherwise the global directory
 * itself is used. This lets sync follow WebUI profile switching.
 */
function resolveActiveProfileConfigPath(): string {
  const link = readLinkState(globalConfigLinkPath());
  const targetDir =
    link.state === "link" && link.target
      ? link.target
      : globalConfigLinkPath();
  return path.join(targetDir, "opencode.jsonc");
}

function readJsonc(path: string): OpendcodeConfig {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(stripJsonc(raw)) as OpendcodeConfig;
}

export function parseJsonSettings(text: string): { mcpServers?: unknown } {
  if (text.trim() === "") return {};
  return JSON.parse(text) as { mcpServers?: unknown };
}

export type SyncStatus = {
  master: {
    path: string;
    exists: boolean;
    servers: string[];
    error: string | null;
  };
  codex: { path: string; exists: boolean };
  claude: { path: string; exists: boolean };
  cursor: { path: string; exists: boolean };
};

/**
 * Read the current master opencode MCP config and the targets' sync state.
 * Returns status info without writing anything.
 */
export function readSyncStatus(): SyncStatus {
  const paths = profilePaths();
  const masterExists = existsSync(paths.opencode);
  const codexExists = existsSync(paths.codex);
  const claudeExists = existsSync(paths.claude);
  const cursorExists = existsSync(paths.cursor);

  let masterServers: string[] = [];
  let masterError: string | null = null;
  if (masterExists) {
    try {
      const master = readJsonc(paths.opencode);
      const mcp = master.mcp || {};
      masterServers = Object.entries(mcp)
        .filter(([name, d]) => isDistributableMcpServer(name) && d.enabled !== false)
        .map(([name]) => name);
    } catch (err) {
      masterError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    master: {
      path: paths.opencode,
      exists: masterExists,
      servers: masterServers,
      error: masterError,
    },
    codex: { path: paths.codex, exists: codexExists },
    claude: { path: paths.claude, exists: claudeExists },
    cursor: { path: paths.cursor, exists: cursorExists },
  };
}


/**
 * Compute sync plan without writing. Returns per-target inSync + messages.
 * Delegated to the shared scripts/lib/sync-engine.mjs (6-1 / P1-b).
 */
export function planSync(): SyncPlan {
  return sharedPlanSync({ paths: profilePaths(), isDistributable: isDistributableMcpServer });
}

export function applySync(): SyncApplyResult {
  return sharedApplySync({ paths: profilePaths(), isDistributable: isDistributableMcpServer });
}

export type { SyncApplyResult, SyncPlan };
