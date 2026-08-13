/**
 * MCP profile conversion helpers shared by the web UI (via `sync-utils.d.mts`)
 * and the CLI sync scripts (REFACTORING_PLAN P1-b / IMPROVEMENT 6-1).
 * Single source of truth: `web/src/lib/profiles/sync-engine.ts` and
 * `scripts/sync-profiles.mjs` both import from here.
 */

export function tomlString(v) {
  if (typeof v !== "string") return String(v);
  const single = v.indexOf("'") === -1 && v.indexOf("\n") === -1;
  if (single) return `'${v}'`;
  const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${esc}"`;
}

export function tomlArray(arr) {
  if (arr.length === 0) return "[]";
  return "[" + arr.map((x) => tomlString(String(x))).join(", ") + "]";
}

export function isEnvRef(v) {
  return typeof v === "string" && /^\{env:[A-Z0-9_]+\}$/i.test(v);
}

export function envValueToCodex(v) {
  return tomlString(String(v));
}

export function envValueToClaude(v) {
  return String(v);
}

export function filterEnv(env) {
  if (!env) return {};
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (isEnvRef(v)) continue;
    out[k] = v;
  }
  return out;
}

export function opencodeMcpToCodex(name, def) {
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

export function opencodeMcpToClaude(name, def) {
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

export function opencodeMcpToCursor(name, def) {
  const entry = {};
  if (def.type === "remote") {
    if (def.url) entry.url = def.url;
    const headers = filterEnv(def.headers);
    if (Object.keys(headers).length) entry.headers = headers;
    return entry;
  }
  const cmd = def.command || [];
  if (cmd[0]) entry.command = cmd[0];
  if (cmd.length > 1) entry.args = cmd.slice(1);
  const env = filterEnv(def.environment);
  if (Object.keys(env).length) entry.env = env;
  return entry;
}

/**
 * Build per-target MCP representations from the opencode master config.
 * `isDistributable` filters names that must not be distributed (e.g. the
 * bundled Browser Bridge); the CLI historically applied no filter and keeps
 * that behaviour by omitting the option.
 */
export function buildTargets(mcp, { isDistributable = () => true } = {}) {
  const codexBlocks = [];
  const claudeServers = {};
  const cursorServers = {};
  const names = [];
  for (const [name, def] of Object.entries(mcp)) {
    if (!isDistributable(name)) continue;
    if (def.enabled === false) continue;
    const c = opencodeMcpToCodex(name, def);
    if (c) codexBlocks.push(c);
    const cl = opencodeMcpToClaude(name, def);
    if (cl) claudeServers[name] = cl;
    const cursor = opencodeMcpToCursor(name, def);
    if (cursor) cursorServers[name] = cursor;
    names.push(name);
  }
  return { codexBlocks, claudeServers, cursorServers, names };
}

export function replaceCodexMcpTables(tomlText, newBlocks) {
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
