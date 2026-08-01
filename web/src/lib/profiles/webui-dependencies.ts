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

function configPath(dir: string): string {
  return ["opencode.jsonc", "opencode.json"]
    .map((name) => path.join(dir, name))
    .find((candidate) => fs.existsSync(candidate)) ?? path.join(dir, "opencode.jsonc");
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

function copyCursorAcpFiles(targetDir: string, sourceDir: string): string[] {
  if (path.resolve(targetDir).toLowerCase() === path.resolve(sourceDir).toLowerCase()) return [];
  const copied: string[] = [];
  for (const relative of ["plugin/cursor-acp.js", "packages/cursor-acp"]) {
    const source = path.join(sourceDir, relative);
    const target = path.join(targetDir, relative);
    if (!fs.existsSync(source) || fs.existsSync(target)) continue;
    copyEntry(source, target);
    copied.push(relative);
  }
  return copied;
}

/** Install WebUI MCP and Cursor ACP dependencies without overwriting settings. */
export function installWebUiDependencies(profileDir: string): string[] {
  const targetConfigPath = configPath(profileDir);
  fs.mkdirSync(profileDir, { recursive: true });
  if (!fs.existsSync(targetConfigPath)) fs.writeFileSync(targetConfigPath, CONFIG_SKELETON, "utf8");

  const sourceDir = opencodeConfigDir();
  const sourceConfigPath = configPath(sourceDir);
  let cursorProvider: Record<string, unknown> | undefined;
  if (fs.existsSync(sourceConfigPath) && path.resolve(sourceConfigPath) !== path.resolve(targetConfigPath)) {
    const sourceRoot = parse(fs.readFileSync(sourceConfigPath, "utf8")) as Record<string, unknown>;
    const provider = sourceRoot.provider;
    const value = provider && typeof provider === "object" && !Array.isArray(provider)
      ? (provider as Record<string, unknown>)["cursor-acp"]
      : undefined;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      cursorProvider = value as Record<string, unknown>;
    }
  }

  let content = fs.readFileSync(targetConfigPath, "utf8");
  const installed = copyCursorAcpFiles(profileDir, sourceDir);
  const formattingOptions = {
    insertSpaces: true,
    tabSize: 2,
    eol: content.includes("\r\n") ? "\r\n" : "\n",
  };
  const entries: [string, string, Record<string, unknown>][] = [
    ["mcp", "browser-bridge", webUiMcpEntry()],
  ];
  if (cursorProvider) entries.push(["provider", "cursor-acp", cursorProvider]);
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
