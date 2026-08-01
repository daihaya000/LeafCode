import fs from "node:fs";
import path from "node:path";
import { applyEdits, modify, parse } from "jsonc-parser";

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

/** Install missing WebUI MCP entries without overwriting user settings. */
export function installWebUiDependencies(profileDir: string): string[] {
  const configPath = ["opencode.jsonc", "opencode.json"]
    .map((name) => path.join(profileDir, name))
    .find((candidate) => fs.existsSync(candidate)) ?? path.join(profileDir, "opencode.jsonc");
  fs.mkdirSync(profileDir, { recursive: true });
  if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, CONFIG_SKELETON, "utf8");

  const content = fs.readFileSync(configPath, "utf8");
  const root = parse(content) as Record<string, unknown>;
  const mcp = root.mcp;
  if (mcp && typeof mcp === "object" && !Array.isArray(mcp) && "browser-bridge" in mcp) {
    return [];
  }

  const formattingOptions = {
    insertSpaces: true,
    tabSize: 2,
    eol: content.includes("\r\n") ? "\r\n" : "\n",
  };
  const next =
    mcp && typeof mcp === "object" && !Array.isArray(mcp)
      ? applyEdits(
          content,
          modify(content, ["mcp", "browser-bridge"], webUiMcpEntry(), {
            formattingOptions,
          }),
        )
      : JSON.stringify(
          { ...root, mcp: { "browser-bridge": webUiMcpEntry() } },
          null,
          2,
        ) + "\n";
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, next, "utf8");
  try {
    fs.renameSync(tempPath, configPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  return ["mcp.browser-bridge"];
}
