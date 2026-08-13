/**
 * Profile sync engine — opencode.jsonc (master) -> codex/claude.
 *
 * Exported functions are used by:
 *   - scripts/sync-profiles.mjs  (CLI entry point)
 *   - web/src/app/api/profiles/sync/route.ts  (WebUI endpoint)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readLinkState } from "./link";
import { globalConfigLinkPath } from "./paths";
import { stripJsonc } from "./jsonc";
import {
  buildTargets,
  replaceCodexMcpTables,
  type McpDefinition,
} from "../../../../scripts/lib/sync-utils.mjs";

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

type CodexTargetStatus = {
  exists: boolean;
  inSync: boolean;
  wouldChange: boolean;
  message: string;
};

type CodexApplyResult = {
  exists: boolean;
  updated: boolean;
  message: string;
};

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

export type SyncPlan = {
  ok: boolean;
  masterServers: string[];
  targets: Record<string, CodexTargetStatus>;
  error?: string;
};

export type SyncApplyResult = {
  ok: boolean;
  masterServers: string[];
  changedFiles: number;
  targets: Record<string, CodexApplyResult>;
  error?: string;
};

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
 */
export function planSync(): SyncPlan {
  const paths = profilePaths();
  if (!existsSync(paths.opencode)) {
    return {
      ok: false,
      error: `master not found: ${paths.opencode}`,
      masterServers: [],
      targets: {},
    };
  }
  const master = readJsonc(paths.opencode);
  const mcp = master.mcp || {};
  const { codexBlocks, claudeServers, cursorServers, names } = buildTargets(mcp, { isDistributable: isDistributableMcpServer });

  const targets: Record<string, CodexTargetStatus> = {};

  if (existsSync(paths.codex)) {
    const original = readFileSync(paths.codex, "utf8");
    const next = replaceCodexMcpTables(original, codexBlocks);
    const inSync = next === original;
    targets.codex = {
      exists: true,
      inSync,
      wouldChange: !inSync,
      message: inSync
        ? `already in sync (${names.length} servers)`
        : `would rewrite mcp_servers (${names.length} servers)`,
    };
  } else {
    targets.codex = {
      exists: false,
      inSync: false,
      wouldChange: false,
      message: `skip: ${paths.codex} not found`,
    };
  }

  if (existsSync(paths.claude)) {
    const original = readFileSync(paths.claude, "utf8");
    const settings = parseJsonSettings(original);
    const before = JSON.stringify(settings.mcpServers ?? null);
    settings.mcpServers = claudeServers;
    const after = JSON.stringify(settings.mcpServers);
    const inSync = before === after;
    targets.claude = {
      exists: true,
      inSync,
      wouldChange: !inSync,
      message: inSync
        ? `already in sync (${names.length} servers)`
        : `would rewrite mcpServers (${names.length} servers)`,
    };
  } else {
    targets.claude = {
      exists: false,
      inSync: false,
      wouldChange: false,
      message: `skip: ${paths.claude} not found`,
    };
  }

  if (existsSync(paths.cursor)) {
    const original = readFileSync(paths.cursor, "utf8");
    const settings = parseJsonSettings(original);
    const before = JSON.stringify(settings.mcpServers ?? null);
    settings.mcpServers = cursorServers;
    const after = JSON.stringify(settings.mcpServers);
    const inSync = before === after;
    targets.cursor = {
      exists: true,
      inSync,
      wouldChange: !inSync,
      message: inSync
        ? `already in sync (${names.length} servers)`
        : `would rewrite mcpServers (${names.length} servers)`,
    };
  } else {
    targets.cursor = {
      exists: false,
      inSync: false,
      wouldChange: false,
      message: `skip: ${paths.cursor} not found`,
    };
  }

  return {
    ok: true,
    masterServers: names,
    targets,
  };
}

/**
 * Apply sync: write the MCP layer of codex/claude from the opencode master.
 * Returns per-target results.
 */
export function applySync(): SyncApplyResult {
  const paths = profilePaths();
  if (!existsSync(paths.opencode)) {
    return {
      ok: false,
      error: `master not found: ${paths.opencode}`,
      masterServers: [],
      changedFiles: 0,
      targets: {},
    };
  }
  const master = readJsonc(paths.opencode);
  const mcp = master.mcp || {};
  const { codexBlocks, claudeServers, cursorServers, names } = buildTargets(mcp, { isDistributable: isDistributableMcpServer });

  const targets: Record<string, CodexApplyResult> = {};
  let changed = 0;

  if (existsSync(paths.codex)) {
    const original = readFileSync(paths.codex, "utf8");
    const next = replaceCodexMcpTables(original, codexBlocks);
    if (next !== original) {
      writeFileSync(paths.codex, next, "utf8");
      changed++;
      targets.codex = {
        exists: true,
        updated: true,
        message: `wrote ${names.length} mcp_servers`,
      };
    } else {
      targets.codex = {
        exists: true,
        updated: false,
        message: `already in sync (${names.length} servers)`,
      };
    }
  } else {
    targets.codex = {
      exists: false,
      updated: false,
      message: `skip: ${paths.codex} not found`,
    };
  }

  if (existsSync(paths.claude)) {
    const original = readFileSync(paths.claude, "utf8");
    const settings = parseJsonSettings(original);
    const before = JSON.stringify(settings.mcpServers ?? null);
    settings.mcpServers = claudeServers;
    const after = JSON.stringify(settings.mcpServers);
    if (before !== after) {
      writeFileSync(paths.claude, JSON.stringify(settings, null, 2) + "\n", "utf8");
      changed++;
      targets.claude = {
        exists: true,
        updated: true,
        message: `wrote ${names.length} mcpServers`,
      };
    } else {
      targets.claude = {
        exists: true,
        updated: false,
        message: `already in sync (${names.length} servers)`,
      };
    }
  } else {
    targets.claude = {
      exists: false,
      updated: false,
      message: `skip: ${paths.claude} not found`,
    };
  }

  if (existsSync(paths.cursor)) {
    const original = readFileSync(paths.cursor, "utf8");
    const settings = parseJsonSettings(original);
    const before = JSON.stringify(settings.mcpServers ?? null);
    settings.mcpServers = cursorServers;
    const after = JSON.stringify(settings.mcpServers);
    if (before !== after) {
      writeFileSync(paths.cursor, JSON.stringify(settings, null, 2) + "\n", "utf8");
      changed++;
      targets.cursor = {
        exists: true,
        updated: true,
        message: `wrote ${names.length} mcpServers`,
      };
    } else {
      targets.cursor = {
        exists: true,
        updated: false,
        message: `already in sync (${names.length} servers)`,
      };
    }
  } else {
    targets.cursor = {
      exists: false,
      updated: false,
      message: `skip: ${paths.cursor} not found`,
    };
  }

  return {
    ok: true,
    masterServers: names,
    changedFiles: changed,
    targets,
  };
}
