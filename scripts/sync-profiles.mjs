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

const HOME = homedir();
const OPENCODE_CONFIG_LINK = path.join(HOME, ".config", "opencode");
const OPENCODE_CONFIG_DEFAULT = path.join(OPENCODE_CONFIG_LINK, "opencode.jsonc");
const CODEX_CONFIG = path.join(HOME, ".codex", "config.toml");
const CLAUDE_SETTINGS = path.join(HOME, ".claude", "settings.json");

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

function stripJsonc(text) {
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

function readJsonc(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(stripJsonc(raw));
}

function tomlString(v) {
  if (typeof v !== "string") return String(v);
  const single = v.indexOf("'") === -1 && v.indexOf("\n") === -1;
  if (single) return `'${v}'`;
  const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${esc}"`;
}

function tomlArray(arr) {
  if (arr.length === 0) return "[]";
  return "[" + arr.map((x) => tomlString(String(x))).join(", ") + "]";
}

function isEnvRef(v) {
  return typeof v === "string" && /^\{env:[A-Z0-9_]+\}$/i.test(v);
}

function envValueToCodex(v) {
  return tomlString(String(v));
}

function envValueToClaude(v) {
  return String(v);
}

function filterEnv(env) {
  if (!env) return {};
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (isEnvRef(v)) continue;
    out[k] = v;
  }
  return out;
}

function opencodeMcpToCodex(name, def) {
  if (def.enabled === false) return null;
  const lines = [];
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

function opencodeMcpToClaude(name, def) {
  if (def.enabled === false) return null;
  const entry = {};
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

function replaceCodexMcpTables(tomlText, newBlocks) {
  const lines = tomlText.split(/\r?\n/);
  const out = [];
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

function buildTargets(mcp) {
  const codexBlocks = [];
  const claudeServers = {};
  const names = [];
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

function planSync() {
  if (!existsSync(OPENCODE_CONFIG)) {
    return {
      ok: false,
      error: `master not found: ${OPENCODE_CONFIG}`,
      masterServers: [],
      targets: {},
    };
  }
  const master = readJsonc(OPENCODE_CONFIG);
  const mcp = master.mcp || {};
  const { codexBlocks, claudeServers, names } = buildTargets(mcp);

  const targets = {};

  if (existsSync(CODEX_CONFIG)) {
    const original = readFileSync(CODEX_CONFIG, "utf8");
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
      message: `skip: ${CODEX_CONFIG} not found`,
    };
  }

  if (existsSync(CLAUDE_SETTINGS)) {
    const original = readFileSync(CLAUDE_SETTINGS, "utf8");
    const settings = JSON.parse(original);
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
      message: `skip: ${CLAUDE_SETTINGS} not found`,
    };
  }

  return { ok: true, masterServers: names, targets };
}

function applySync() {
  if (!existsSync(OPENCODE_CONFIG)) {
    return {
      ok: false,
      error: `master not found: ${OPENCODE_CONFIG}`,
      masterServers: [],
      changedFiles: 0,
      targets: {},
    };
  }
  const master = readJsonc(OPENCODE_CONFIG);
  const mcp = master.mcp || {};
  const { codexBlocks, claudeServers, names } = buildTargets(mcp);

  const targets = {};
  let changed = 0;

  if (existsSync(CODEX_CONFIG)) {
    const original = readFileSync(CODEX_CONFIG, "utf8");
    const next = replaceCodexMcpTables(original, codexBlocks);
    if (next !== original) {
      writeFileSync(CODEX_CONFIG, next, "utf8");
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
      message: `skip: ${CODEX_CONFIG} not found`,
    };
  }

  if (existsSync(CLAUDE_SETTINGS)) {
    const original = readFileSync(CLAUDE_SETTINGS, "utf8");
    const settings = JSON.parse(original);
    const before = JSON.stringify(settings.mcpServers ?? null);
    settings.mcpServers = claudeServers;
    const after = JSON.stringify(settings.mcpServers);
    if (before !== after) {
      writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + "\n", "utf8");
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
      message: `skip: ${CLAUDE_SETTINGS} not found`,
    };
  }

  return { ok: true, masterServers: names, changedFiles: changed, targets };
}

if (dryRun) {
  const plan = planSync();
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

const result = applySync();
if (!result.ok) {
  console.error(`[sync-profiles] ${result.error}`);
  process.exit(2);
}
console.log(`[sync-profiles] master: ${OPENCODE_CONFIG}`);
for (const [name, t] of Object.entries(result.targets)) {
  console.log(`[${name}] ${t.message}`);
}
console.log(`[sync-profiles] done (${result.changedFiles} file(s) updated)`);