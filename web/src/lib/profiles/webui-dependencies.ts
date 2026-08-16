import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { applyEdits, modify, parse } from "jsonc-parser";
import { opencodeConfigDir } from "../opencode-extensions/paths";

const VENDOR_VERSIONS_FILE = ".webui-vendor-versions.json";

const CONFIG_SKELETON = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
const BROKER_URL = "{env:LEAFCODE_BROWSER_BROKER}";
const BROKER_TOKEN = "{env:LEAFCODE_BROWSER_BROKER_TOKEN}";

/**
 * OpenCode-side dependencies used by the WebUI.  The browser extension itself
 * is shipped with this application; this entry makes its MCP endpoint
 * available in every newly-created OpenCode profile.
 */
export function webUiMcpEntry(): Record<string, unknown> {
  const cwd = path.resolve(process.cwd());
  const roots = process.env.LEAFCODE_ROOT?.trim()
    ? [path.resolve(process.env.LEAFCODE_ROOT)]
    : [cwd, path.dirname(cwd)];
  const root = roots.find((candidate) => fs.existsSync(
    path.join(candidate, "browser-bridge", "mcp", "server.mjs"),
  )) ?? roots[0];
  return {
    type: "local",
    command: ["node", path.join(root, "browser-bridge", "mcp", "server.mjs")],
    enabled: true,
    environment: {
      LEAFCODE_BROWSER_BROKER: BROKER_URL,
      LEAFCODE_BROWSER_BROKER_TOKEN: BROKER_TOKEN,
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
  const root = process.env.LEAFCODE_ROOT?.trim()
    ? path.resolve(process.env.LEAFCODE_ROOT)
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

/**
 * Canonical form of a path for identity comparison.  Profile dirs are reached
 * through junctions/symlinks (`~/.config/opencode` → the active profile), so a
 * plain string compare would treat the same physical dir as two different ones.
 */
function canonicalPath(target: string): string {
  const resolved = path.resolve(target);
  try {
    return fs.realpathSync.native(resolved).toLowerCase();
  } catch {
    return resolved.toLowerCase();
  }
}

function isSameDirectory(a: string, b: string): boolean {
  return canonicalPath(a) === canonicalPath(b);
}

/** Copy a CLI-proxy plugin's runtime files into a profile dir from the first matching source dir. */
function copyVendorFiles(targetDir: string, sourceDirs: string[], relatives: string[]): string[] {
  const copied: string[] = [];
  for (const relative of relatives) {
    const target = path.join(targetDir, relative);
    for (const sourceDir of sourceDirs) {
      if (isSameDirectory(targetDir, sourceDir)) continue;
      if (isSameDirectory(path.join(sourceDir, relative), target)) continue;
      const source = path.join(sourceDir, relative);
      if (!fs.existsSync(source)) continue;
      // Overwrite when the bundled hash differs from the installed marker.
      const bundledHash = hashEntry(source);
      const installedHash = readVendorVersion(targetDir, relative);
      if (fs.existsSync(target) && installedHash === bundledHash) break;
      copyEntry(source, target);
      writeVendorVersion(targetDir, relative, bundledHash);
      copied.push(relative);
      break;
    }
  }
  return copied;
}

/** Record of vendored-path → content-hash installed into a profile. */
type VendorVersions = Record<string, string>;

function vendorVersionsPath(targetDir: string): string {
  return path.join(targetDir, VENDOR_VERSIONS_FILE);
}

function readVendorVersions(targetDir: string): VendorVersions {
  const filePath = vendorVersionsPath(targetDir);
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as VendorVersions)
      : {};
  } catch {
    return {};
  }
}

function writeVendorVersions(targetDir: string, versions: VendorVersions): void {
  if (!fs.existsSync(targetDir)) return;
  const tempPath = `${vendorVersionsPath(targetDir)}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(versions, null, 2), "utf8");
  try {
    fs.renameSync(tempPath, vendorVersionsPath(targetDir));
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function readVendorVersion(targetDir: string, relative: string): string | undefined {
  return readVendorVersions(targetDir)[relative];
}

function writeVendorVersion(targetDir: string, relative: string, hash: string): void {
  const versions = readVendorVersions(targetDir);
  versions[relative] = hash;
  writeVendorVersions(targetDir, versions);
}

/** Stable content hash of a file/dir (follows tree ascending, ignores symlink identity). */
function hashEntry(source: string): string {
  const parts: string[] = [];
  const walk = (entryPath: string): void => {
    const info = fs.lstatSync(entryPath);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const name of fs.readdirSync(entryPath).sort()) {
        walk(path.join(entryPath, name));
      }
      return;
    }
    parts.push(crypto.createHash("sha256").update(fs.readFileSync(entryPath)).digest("hex"));
  };
  walk(source);
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
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
    // Legacy commandcode.js (pre-CLI-proxy era)
    ["plugin/commandcode.js", "plugin/commandcode-cli-proxy.js"],
    ["packages/commandcode", "packages/commandcode-cli-proxy"],
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

/**
 * Migrate renamed provider keys in a profile's opencode.jsonc.
 * Currently: `provider.cursor-acp` → `provider.cursor` (when `cursor` not yet set).
 * Idempotent: returns an empty array when no change is needed.
 * Atomic: temp file + rename.
 */
export function migrateProviderIds(profileDir: string): string[] {
  const result: string[] = [];
  result.push(...migrateProviderConfig(profileDir));
  result.push(...migrateAgentModels(profileDir));
  return result;
}

function migrateProviderConfig(profileDir: string): string[] {
  const targetConfigPath = configPath(profileDir);
  if (!fs.existsSync(targetConfigPath)) return [];
  const content = fs.readFileSync(targetConfigPath, "utf8");
  const root = parse(content) as Record<string, unknown>;
  const provider = root.provider;
  const providerObj = provider && typeof provider === "object" && !Array.isArray(provider)
    ? provider as Record<string, unknown>
    : undefined;
  if (!providerObj || providerObj["cursor-acp"] === undefined || providerObj["cursor"] !== undefined) {
    return [];
  }
  providerObj["cursor"] = providerObj["cursor-acp"];
  delete providerObj["cursor-acp"];
  const edits = modify(content, ["provider"], providerObj, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: content.includes("\r\n") ? "\r\n" : "\n",
    },
  });
  const next = applyEdits(content, edits);
  if (next === content) return [];
  const tempPath = `${targetConfigPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, next, "utf8");
  try {
    fs.renameSync(tempPath, targetConfigPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  return ["migrated:provider.cursor-acp->cursor"];
}

function migrateAgentModels(profileDir: string): string[] {
  const migrated: string[] = [];
  const OLD_MODEL = /cursor-acp::/g;
  for (const dirName of ["agents", "agent"]) {
    const dir = path.join(profileDir, dirName);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const filePath = path.join(dir, entry.name);
      const original = fs.readFileSync(filePath, "utf8");
      const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(original);
      if (!frontMatter) continue;
      const oldBlock = frontMatter[1];
      const newBlock = oldBlock.replace(OLD_MODEL, "cursor::");
      if (newBlock === oldBlock) continue;
      const replaced = original.replace(frontMatter[0], `---\n${newBlock}\n---`);
      const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tempPath, replaced, "utf8");
      try {
        fs.renameSync(tempPath, filePath);
      } catch (error) {
        fs.rmSync(tempPath, { force: true });
        throw error;
      }
      migrated.push(`migrated:agent-model:${dirName}/${entry.name}`);
    }
  }
  return migrated;
}

/** Install WebUI MCPs and the Cursor/Claude/CommandCode CLI Proxy dependencies without overwriting settings. */
export function installWebUiDependencies(
  profileDir: string,
  options: WebUiDependencyOptions = {},
): string[] {
  const targetConfigPath = configPath(profileDir);
  fs.mkdirSync(profileDir, { recursive: true });
  if (!fs.existsSync(targetConfigPath)) fs.writeFileSync(targetConfigPath, CONFIG_SKELETON, "utf8");

  const activeDir = opencodeConfigDir();
  const bundledDir = bundledVendorDir("cursor-cli-proxy", "LEAFCODE_CURSOR_CLI_PROXY_DIR");
  const bundledClaudeAuth = bundledVendorDir("claude-cli-proxy", "LEAFCODE_CLAUDE_CLI_PROXY_DIR");
  const bundledCommandcodeCli = bundledVendorDir("commandcode-cli-proxy", "LEAFCODE_COMMANDCODE_CLI_PROXY_DIR");
  const sourceDirs = [activeDir, bundledDir].filter(
    (dir, index, all): dir is string => Boolean(dir) && all.indexOf(dir) === index,
  );
  let cursorProvider: Record<string, unknown> | undefined;
  for (const sourceDir of sourceDirs) {
    const sourceConfigPath = configPath(sourceDir);
    if (!fs.existsSync(sourceConfigPath) || path.resolve(sourceConfigPath) === path.resolve(targetConfigPath)) continue;
    const sourceRoot = parse(fs.readFileSync(sourceConfigPath, "utf8")) as Record<string, unknown>;
    const provider = sourceRoot.provider;
    // Fall back to the legacy `cursor-acp` key when `cursor` is not present.
    const providerMap = provider && typeof provider === "object" && !Array.isArray(provider)
      ? (provider as Record<string, unknown>)
      : undefined;
    const value = providerMap?.["cursor"] ?? providerMap?.["cursor-acp"];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      cursorProvider = value as Record<string, unknown>;
      break;
    }
  }

  let anthropicProvider: Record<string, unknown> | undefined;
  if (options.claudeAuth !== false && bundledClaudeAuth) {
    const sourceConfigPath = configPath(bundledClaudeAuth);
    if (fs.existsSync(sourceConfigPath) && path.resolve(sourceConfigPath) !== path.resolve(targetConfigPath)) {
      const sourceRoot = parse(fs.readFileSync(sourceConfigPath, "utf8")) as Record<string, unknown>;
      const provider = sourceRoot.provider;
      const providerMap = provider && typeof provider === "object" && !Array.isArray(provider)
        ? (provider as Record<string, unknown>)
        : undefined;
      const value = providerMap?.["anthropic"];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        anthropicProvider = value as Record<string, unknown>;
      }
    }
  }

  const installed: string[] = [];
  // Replace old-named vendor files before copying new ones
  installed.push(...replaceOldVendorFiles(profileDir));
  // Migrate renamed provider keys (cursor-acp → cursor) in the target config.
  installed.push(...migrateProviderIds(profileDir));
  let content = fs.readFileSync(targetConfigPath, "utf8");
  if (options.cursorAcp !== false) {
    // Runtime code comes from the shipped bundle first; the active profile is
    // only a fallback for installs that predate the bundled copy.
    const codeSourceDirs = [bundledDir, activeDir].filter(
      (dir, index, all): dir is string => Boolean(dir) && all.indexOf(dir) === index,
    );
    installed.push(...copyVendorFiles(profileDir, codeSourceDirs, ["plugin/cursor-cli-proxy.js", "packages/cursor-cli-proxy"]));
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
  if (options.cursorAcp !== false && cursorProvider) entries.push(["provider", "cursor", cursorProvider]);
  if (options.claudeAuth !== false && anthropicProvider) entries.push(["provider", "anthropic", anthropicProvider]);
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
