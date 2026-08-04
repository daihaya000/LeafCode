import fs from "node:fs";
import path from "node:path";
import { applyEdits, modify, parse } from "jsonc-parser";
import { opencodeConfigDir } from "../opencode-extensions/paths";

const CONFIG_SKELETON = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
const BROKER_URL = "{env:OPENCODE_WEBUI_BROWSER_BROKER}";
const BROKER_TOKEN = "{env:OPENCODE_WEBUI_BROWSER_BROKER_TOKEN}";

/**
 * OpenCode-side dependencies used by the WebUI.  The browser extension itself
 * is shipped with this application; this entry makes its MCP endpoint
 * available in every newly-created OpenCode profile.
 */
export function webUiMcpEntry(): Record<string, unknown> {
  const root = process.env.OPENCODE_WEBUI_ROOT?.trim()
    ? path.resolve(process.env.OPENCODE_WEBUI_ROOT)
    : path.resolve(process.cwd());
  return {
    type: "local",
    command: ["node", path.join(root, "browser-bridge", "mcp", "server.mjs")],
    enabled: true,
    environment: {
      OPENCODE_WEBUI_BROWSER_BROKER: BROKER_URL,
      OPENCODE_WEBUI_BROWSER_BROKER_TOKEN: BROKER_TOKEN,
    },
  };
}

export type WebUiDependencyOptions = {
  browserBridge?: boolean;
  cursorAcp?: boolean;
  claudeAuth?: boolean;
  commandcodeAuth?: boolean;
};


function configPath(dir: string): string {
  return ["opencode.jsonc", "opencode.json"]
    .map((name) => path.join(dir, name))
    .find((candidate) => fs.existsSync(candidate)) ?? path.join(dir, "opencode.jsonc");
}

/** Locate a vendored CLI-proxy plugin dir (repo bundle, optionally overridden by env var). */
function bundledVendorDir(vendorName: string, envVar?: string): string | undefined {
  const explicit = envVar ? process.env[envVar]?.trim() : undefined;
  if (explicit) return path.resolve(explicit);
  const root = process.env.OPENCODE_WEBUI_ROOT?.trim()
    ? path.resolve(process.env.OPENCODE_WEBUI_ROOT)
    : path.resolve(process.cwd());
  const candidates = [path.join(root, "vendor", vendorName), path.join(root, "..", "vendor", vendorName)];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function copyEntry(source: string, target: string): void {
  const info = fs.lstatSync(source);
  if (info.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const linkType = fs.statSync(source).isDirectory() ? "junction" : "file";
    fs.symlinkSync(fs.readlinkSync(source), target, linkType);
    return;
  }
  if (info.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyEntry(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

/** Copy a CLI-proxy plugin's runtime files into a profile dir from the first matching source dir. */
function copyVendorFiles(targetDir: string, sourceDirs: string[], relatives: string[]): string[] {
  const copied: string[] = [];
  for (const relative of relatives) {
    const target = path.join(targetDir, relative);
    if (fs.existsSync(target)) continue;
    for (const sourceDir of sourceDirs) {
      if (path.resolve(targetDir).toLowerCase() === path.resolve(sourceDir).toLowerCase()) continue;
      const source = path.join(sourceDir, relative);
      if (!fs.existsSync(source)) continue;
      copyEntry(source, target);
      copied.push(relative);
      break;
    }
  }
  return copied;
}

function removeLegacyCommandcodeFiles(targetDir: string): string[] {
  const removed: string[] = [];
  for (const relative of ["plugin/commandcode.js", "packages/commandcode"]) {
    const target = path.join(targetDir, relative);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(`removed:${relative}`);
  }
  return removed;
}

/** Remove old-named vendor plugin files before copying the renamed versions. */
function replaceOldVendorFiles(targetDir: string): string[] {
  const removed: string[] = [];
  const oldNew: [string, string][] = [
    ["plugin/cursor-acp.js", "plugin/cursor-cli-proxy.js"],
    ["packages/cursor-acp", "packages/cursor-cli-proxy"],
    ["plugin/claude-auth.js", "plugin/claude-cli-proxy.js"],
    ["packages/claude-auth", "packages/claude-cli-proxy"],
    ["plugin/commandcode-cli.js", "plugin/commandcode-cli-proxy.js"],
    ["packages/commandcode-cli", "packages/commandcode-cli-proxy"],
  ];
  for (const [oldRel, newRel] of oldNew) {
    const oldPath = path.join(targetDir, oldRel);
    if (!fs.existsSync(oldPath)) continue;
    // Remove the new-name target first if it exists (stale from partial rename)
    const newPath = path.join(targetDir, newRel);
    if (fs.existsSync(newPath)) fs.rmSync(newPath, { recursive: true, force: true });
    fs.rmSync(oldPath, { recursive: true, force: true });
    removed.push(`replaced:${oldRel}->${newRel}`);
  }
  return removed;
}

/** Install WebUI MCP and the Cursor/Claude/CommandCode CLI Proxy dependencies without overwriting settings. */
export function installWebUiDependencies(
  profileDir: string,
  options: WebUiDependencyOptions = {},
): string[] {
  const targetConfigPath = configPath(profileDir);
  fs.mkdirSync(profileDir, { recursive: true });
  if (!fs.existsSync(targetConfigPath)) fs.writeFileSync(targetConfigPath, CONFIG_SKELETON, "utf8");

  const activeDir = opencodeConfigDir();
  const bundledDir = bundledVendorDir("cursor-cli-proxy", "OPENCODE_WEBUI_CURSOR_CLI_PROXY_DIR");
  const bundledClaudeAuth = bundledVendorDir("claude-cli-proxy", "OPENCODE_WEBUI_CLAUDE_CLI_PROXY_DIR");
  const bundledCommandcodeCli = bundledVendorDir("commandcode-cli-proxy");
  const sourceDirs = [activeDir, bundledDir].filter(
    (dir, index, all): dir is string => Boolean(dir) && all.indexOf(dir) === index,
  );
  let cursorProvider: Record<string, unknown> | undefined;
  for (const sourceDir of sourceDirs) {
    const sourceConfigPath = configPath(sourceDir);
    if (!fs.existsSync(sourceConfigPath) || path.resolve(sourceConfigPath) === path.resolve(targetConfigPath)) continue;
    const sourceRoot = parse(fs.readFileSync(sourceConfigPath, "utf8")) as Record<string, unknown>;
    const provider = sourceRoot.provider;
    const value = provider && typeof provider === "object" && !Array.isArray(provider)
      ? (provider as Record<string, unknown>)["cursor-acp"]
      : undefined;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      cursorProvider = value as Record<string, unknown>;
      break;
    }
  }

  let content = fs.readFileSync(targetConfigPath, "utf8");
  const installed: string[] = [];
  // Replace old-named vendor files before copying new ones
  installed.push(...replaceOldVendorFiles(profileDir));
  if (options.commandcodeAuth !== false) installed.push(...removeLegacyCommandcodeFiles(profileDir));
  if (options.cursorAcp !== false) {
    installed.push(...copyVendorFiles(profileDir, sourceDirs, ["plugin/cursor-cli-proxy.js", "packages/cursor-cli-proxy"]));
  }
  if (options.claudeAuth !== false && bundledClaudeAuth) {
    installed.push(...copyVendorFiles(profileDir, [bundledClaudeAuth], ["plugin/claude-cli-proxy.js", "packages/claude-cli-proxy"]));
  }
  if (options.commandcodeAuth !== false && bundledCommandcodeCli) {
    installed.push(...copyVendorFiles(profileDir, [bundledCommandcodeCli], ["plugin/commandcode-cli-proxy.js", "packages/commandcode-cli-proxy"]));
  }
  const formattingOptions = {
    insertSpaces: true,
    tabSize: 2,
    eol: content.includes("\r\n") ? "\r\n" : "\n",
  };
  const entries: [string, string, Record<string, unknown>][] = [];
  if (options.browserBridge !== false) {
    entries.push(["mcp", "browser-bridge", webUiMcpEntry()]);
  }
  if (options.cursorAcp !== false && cursorProvider) entries.push(["provider", "cursor-acp", cursorProvider]);
  for (const [parent, name, value] of entries) {
    const root = parse(content) as Record<string, unknown>;
    const current = root[parent];
    const object = current && typeof current === "object" && !Array.isArray(current)
      ? current as Record<string, unknown>
      : undefined;
    if (object?.[name] !== undefined) continue;
    const edits = modify(
      content,
      object ? [parent, name] : [parent],
      object ? value : { [name]: value },
      { formattingOptions },
    );
    content = applyEdits(content, edits);
    installed.push(`${parent}.${name}`);
  }
  if (content !== fs.readFileSync(targetConfigPath, "utf8")) {
    const tempPath = `${targetConfigPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, content, "utf8");
    try {
      fs.renameSync(tempPath, targetConfigPath);
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }
  return installed;
}
