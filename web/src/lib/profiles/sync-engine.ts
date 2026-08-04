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

const HOME = homedir();

type EnvMap = Record<string, string>;

type McpDefinition = {
  type?: "local" | "remote";
  command?: string[];
  url?: string;
  headers?: EnvMap;
  environment?: EnvMap;
  enabled?: boolean;
};

type OpendcodeConfig = {
  mcp?: Record<string, McpDefinition>;
};

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

function stripJsonc(text: string): string {
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

function readJsonc(path: string): OpendcodeConfig {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(stripJsonc(raw)) as OpendcodeConfig;
}

function tomlString(v: string): string {
  const single = v.indexOf("'") === -1 && v.indexOf("\n") === -1;
  if (single) return `'${v}'`;
  const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${esc}"`;
}

function tomlArray(arr: string[]): string {
  if (arr.length === 0) return "[]";
  return "[" + arr.map((x) => tomlString(String(x))).join(", ") + "]";
}

function isEnvRef(v: string): boolean {
  return /^\{env:[A-Z0-9_]+\}$/i.test(v);
}

function envValueToCodex(v: string): string {
  return tomlString(String(v));
}

function envValueToClaude(v: string): string {
  return String(v);
}

function filterEnv(env: EnvMap | undefined): EnvMap {
  if (!env) return {};
  const out: EnvMap = {};
  for (const [k, v] of Object.entries(env)) {
    if (isEnvRef(v)) continue;
    out[k] = v;
  }
  return out;
}

function opencodeMcpToCodex(name: string, def: McpDefinition): string | null {
  if (def.enabled === false) return null;
  const lines: string[] = [];
  lines.push(`[mcp_servers.${name}]`);
  if (def.type === "remote") {
    if (def.url) lines.push(`url = ${tomlString(def.url)}`);
    const headers = filterEnv(def.headers);
    if (Object.keys(headers).length) {
      lines.push("");
      lines.push(`[mcp_servers.${name}.headers]`);
      for (const [k, v] of Object.entries(headers)) {
        lines.push(`${k} = ${envValueToCodex(v)}`);
      }
    }
    return lines.join("\n");
  }
  const cmd = def.command || [];
  if (cmd[0]) lines.push(`command = ${tomlString(cmd[0])}`);
  if (cmd.length > 1) lines.push(`args = ${tomlArray(cmd.slice(1))}`);
  const env = filterEnv(def.environment);
  if (Object.keys(env).length) {
    lines.push("");
    lines.push(`[mcp_servers.${name}.env]`);
    for (const [k, v] of Object.entries(env)) {
      lines.push(`${k} = ${envValueToCodex(v)}`);
    }
  }
  return lines.join("\n");
}

type ClaudeMcpEntry = {
  type?: string;
  url?: string;
  headers?: EnvMap;
  command?: string;
  args?: string[];
  env?: EnvMap;
};

function opencodeMcpToClaude(name: string, def: McpDefinition): ClaudeMcpEntry | null {
  if (def.enabled === false) return null;
  const entry: ClaudeMcpEntry = {};
  if (def.type === "remote") {
    entry.type = "sse";
    if (def.url) entry.url = def.url;
    const headers = filterEnv(def.headers);
    if (Object.keys(headers).length) {
      entry.headers = {};
      for (const [k, v] of Object.entries(headers)) {
        entry.headers[k] = envValueToClaude(v);
      }
    }
    return entry;
  }
  const cmd = def.command || [];
  if (cmd[0]) entry.command = cmd[0];
  if (cmd.length > 1) entry.args = cmd.slice(1);
  const env = filterEnv(def.environment);
  if (Object.keys(env).length) {
    entry.env = {};
    for (const [k, v] of Object.entries(env)) {
      entry.env[k] = envValueToClaude(v);
    }
  }
  return entry;
}

function replaceCodexMcpTables(tomlText: string, newBlocks: string[]): string {
  const lines = tomlText.split(/\r?\n/);
  const out: string[] = [];
  let skip = false;
  for (const line of lines) {
    const head = line.trim().match(/^\[mcp_servers\.([^\]]+)\]/);
    if (head) {
      skip = true;
      continue;
    }
    if (skip) {
      if (/^\[[^\]]+\]/.test(line.trim()) && !line.trim().startsWith("[mcp_servers.")) {
        skip = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  let cleaned = out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
  if (newBlocks.length) {
    cleaned = cleaned + "\n\n" + newBlocks.join("\n\n") + "\n";
  } else {
    cleaned = cleaned + "\n";
  }
  return cleaned;
}

function buildTargets(mcp: Record<string, McpDefinition>) {
  const codexBlocks: string[] = [];
  const claudeServers: Record<string, ClaudeMcpEntry> = {};
  const names: string[] = [];
  for (const [name, def] of Object.entries(mcp)) {
    if (def.enabled === false) continue;
    const c = opencodeMcpToCodex(name, def);
    if (c) codexBlocks.push(c);
    const cl = opencodeMcpToClaude(name, def);
    if (cl) claudeServers[name] = cl;
    names.push(name);
  }
  return { codexBlocks, claudeServers, names };
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

  let masterServers: string[] = [];
  let masterError: string | null = null;
  if (masterExists) {
    try {
      const master = readJsonc(paths.opencode);
      const mcp = master.mcp || {};
      masterServers = Object.entries(mcp)
        .filter(([, d]) => d.enabled !== false)
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
  const { codexBlocks, claudeServers, names } = buildTargets(mcp);

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
    const settings = JSON.parse(original) as { mcpServers?: unknown };
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
  const { codexBlocks, claudeServers, names } = buildTargets(mcp);

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
    const settings = JSON.parse(original) as { mcpServers?: unknown };
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

  return {
    ok: true,
    masterServers: names,
    changedFiles: changed,
    targets,
  };
}