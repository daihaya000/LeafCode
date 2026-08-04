/**
 * sync-profiles.mjs
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
 *   --check  dry-run; print diff and exit non-zero if changes would be made
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const OPENCODE_CONFIG = join(HOME, ".config", "opencode", "opencode.jsonc");
const CODEX_CONFIG = join(HOME, ".codex", "config.toml");
const CLAUDE_SETTINGS = join(HOME, ".claude", "settings.json");

const dryRun = process.argv.includes("--check");

function readJsonc(path) {
  const raw = readFileSync(path, "utf8");
  const stripped = stripJsonc(raw);
  return JSON.parse(stripped);
}

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

function envValueToString(v) {
  return String(v);
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
      } else if (line.trim() === "" && out[out.length - 1] !== "") {
      } else {
      }
      continue;
    }
    out.push(line);
  }
  let cleaned = out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/,"");
  if (newBlocks.length) {
    cleaned = cleaned.replace(/\s+$/,"") + "\n\n" + newBlocks.join("\n\n") + "\n";
  } else {
    cleaned = cleaned + "\n";
  }
  return cleaned;
}

function main() {
  if (!existsSync(OPENCODE_CONFIG)) {
    console.error(`[sync-profiles] master not found: ${OPENCODE_CONFIG}`);
    process.exit(2);
  }
  const master = readJsonc(OPENCODE_CONFIG);
  const mcp = master.mcp || {};

  const enabledServers = Object.entries(mcp).filter(([, d]) => d.enabled !== false);

  const codexBlocks = [];
  const claudeServers = {};
  for (const [name, def] of Object.entries(mcp)) {
    if (def.enabled === false) continue;
    const c = opencodeMcpToCodex(name, def);
    if (c) codexBlocks.push(c);
    const cl = opencodeMcpToClaude(name, def);
    if (cl) claudeServers[name] = cl;
  }

  let changed = 0;

  if (existsSync(CODEX_CONFIG)) {
    const original = readFileSync(CODEX_CONFIG, "utf8");
    const next = replaceCodexMcpTables(original, codexBlocks);
    if (next !== original) {
      changed++;
      if (dryRun) {
        console.log("[codex] would rewrite mcp_servers tables");
      } else {
        writeFileSync(CODEX_CONFIG, next, "utf8");
        console.log(`[codex] wrote ${enabledServers.length} mcp_servers -> ${CODEX_CONFIG}`);
      }
    } else {
      console.log(`[codex] already in sync (${enabledServers.length} servers)`);
    }
  } else {
    console.log(`[codex] skip: ${CODEX_CONFIG} not found`);
  }

  if (existsSync(CLAUDE_SETTINGS)) {
    const original = readFileSync(CLAUDE_SETTINGS, "utf8");
    const settings = JSON.parse(original);
    const before = JSON.stringify(settings.mcpServers ?? null);
    settings.mcpServers = claudeServers;
    const after = JSON.stringify(settings.mcpServers);
    if (before !== after) {
      changed++;
      if (dryRun) {
        console.log("[claude] would rewrite mcpServers");
      } else {
        writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + "\n", "utf8");
        console.log(`[claude] wrote ${enabledServers.length} mcpServers -> ${CLAUDE_SETTINGS}`);
      }
    } else {
      console.log(`[claude] already in sync (${enabledServers.length} servers)`);
    }
  } else {
    console.log(`[claude] skip: ${CLAUDE_SETTINGS} not found`);
  }

  if (dryRun && changed > 0) process.exit(1);
  console.log(`[sync-profiles] done (${changed} file(s) ${dryRun ? "would change" : "updated"})`);
}

main();