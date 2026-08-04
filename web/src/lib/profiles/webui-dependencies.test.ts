import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installWebUiDependencies } from "./webui-dependencies";

const dirs: string[] = [];
let previousConfigDir: string | undefined;
let previousCursorCliProxyDir: string | undefined;
let previousClaudeCliProxyDir: string | undefined;
let previousRoot: string | undefined;

beforeEach(() => {
  previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
  previousCursorCliProxyDir = process.env.OPENCODE_WEBUI_CURSOR_CLI_PROXY_DIR;
  previousClaudeCliProxyDir = process.env.OPENCODE_WEBUI_CLAUDE_CLI_PROXY_DIR;
  previousRoot = process.env.OPENCODE_WEBUI_ROOT;
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-source-"));
  dirs.push(source);
  process.env.OPENCODE_CONFIG_DIR = source;
  process.env.OPENCODE_WEBUI_CURSOR_CLI_PROXY_DIR = path.join(source, "bundled");
  process.env.OPENCODE_WEBUI_CLAUDE_CLI_PROXY_DIR = path.join(source, "claude-bundled");
  process.env.OPENCODE_WEBUI_ROOT = source;
  fs.mkdirSync(path.join(source, "vendor", "commandcode-cli-proxy", "plugin"), { recursive: true });
  fs.mkdirSync(path.join(source, "vendor", "commandcode-cli-proxy", "packages", "commandcode-cli-proxy"), { recursive: true });
  fs.writeFileSync(path.join(source, "vendor", "commandcode-cli-proxy", "plugin", "commandcode-cli-proxy.js"), "export default {};");
  fs.writeFileSync(path.join(source, "vendor", "commandcode-cli-proxy", "packages", "commandcode-cli-proxy", "index.mjs"), "export default {};");
});

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
  else process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
  if (previousCursorCliProxyDir === undefined) delete process.env.OPENCODE_WEBUI_CURSOR_CLI_PROXY_DIR;
  else process.env.OPENCODE_WEBUI_CURSOR_CLI_PROXY_DIR = previousCursorCliProxyDir;
  if (previousClaudeCliProxyDir === undefined) delete process.env.OPENCODE_WEBUI_CLAUDE_CLI_PROXY_DIR;
  else process.env.OPENCODE_WEBUI_CLAUDE_CLI_PROXY_DIR = previousClaudeCliProxyDir;
  if (previousRoot === undefined) delete process.env.OPENCODE_WEBUI_ROOT;
  else process.env.OPENCODE_WEBUI_ROOT = previousRoot;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("installWebUiDependencies", () => {
  it("adds the Browser Bridge MCP entry to a new profile", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-"));
    dirs.push(dir);

    expect(installWebUiDependencies(dir, { commandcodeAuth: false })).toEqual(["mcp.browser-bridge"]);
    const config = JSON.parse(fs.readFileSync(path.join(dir, "opencode.jsonc"), "utf8"));
    expect(config.mcp["browser-bridge"].command[0]).toBe("node");
    expect(config.mcp["browser-bridge"].environment).toEqual({
      OPENCODE_WEBUI_BROWSER_BROKER: "{env:OPENCODE_WEBUI_BROWSER_BROKER}",
      OPENCODE_WEBUI_BROWSER_BROKER_TOKEN: "{env:OPENCODE_WEBUI_BROWSER_BROKER_TOKEN}",
    });
  });

  it("does not overwrite an existing Browser Bridge configuration", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-"));
    dirs.push(dir);
    const configPath = path.join(dir, "opencode.jsonc");
    fs.writeFileSync(configPath, '{ "mcp": { "browser-bridge": { "command": ["custom"] } } }');

    expect(installWebUiDependencies(dir, { commandcodeAuth: false })).toEqual([]);
    expect(fs.readFileSync(configPath, "utf8")).toContain("custom");
  });

  it("copies Cursor CLI Proxy plugin files and provider settings from the active profile", () => {
    const source = process.env.OPENCODE_CONFIG_DIR!;
    fs.writeFileSync(
      path.join(source, "opencode.jsonc"),
      JSON.stringify({ provider: { "cursor-acp": { name: "Cursor", models: { auto: {} } } } }),
    );
    fs.mkdirSync(path.join(source, "plugin"), { recursive: true });
    fs.writeFileSync(path.join(source, "plugin", "cursor-cli-proxy.js"), "export default {};\n");
    fs.mkdirSync(path.join(source, "packages", "cursor-cli-proxy"), { recursive: true });
    fs.writeFileSync(path.join(source, "packages", "cursor-cli-proxy", "index.js"), "export default {};\n");

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);
    const installed = installWebUiDependencies(target, { commandcodeAuth: false });

    expect(installed).toContain("plugin/cursor-cli-proxy.js");
    expect(installed).toContain("packages/cursor-cli-proxy");
    expect(installed).toContain("provider.cursor-acp");
    expect(fs.existsSync(path.join(target, "packages", "cursor-cli-proxy", "index.js"))).toBe(true);
    const config = JSON.parse(fs.readFileSync(path.join(target, "opencode.jsonc"), "utf8"));
    expect(config.provider["cursor-acp"].name).toBe("Cursor");
  });

  it("uses the repository bundle when the active profile has no Cursor CLI Proxy", () => {
    const bundle = process.env.OPENCODE_WEBUI_CURSOR_CLI_PROXY_DIR!;
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(
      path.join(bundle, "opencode.jsonc"),
      JSON.stringify({ provider: { "cursor-acp": { name: "Bundled Cursor" } } }),
    );
    fs.mkdirSync(path.join(bundle, "plugin"), { recursive: true });
    fs.writeFileSync(path.join(bundle, "plugin", "cursor-cli-proxy.js"), "export default {};\n");
    fs.mkdirSync(path.join(bundle, "packages", "cursor-cli-proxy"), { recursive: true });
    fs.writeFileSync(path.join(bundle, "packages", "cursor-cli-proxy", "index.js"), "export default {};\n");

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);
    installWebUiDependencies(target, { commandcodeAuth: false });

    const config = JSON.parse(fs.readFileSync(path.join(target, "opencode.jsonc"), "utf8"));
    expect(config.provider["cursor-acp"].name).toBe("Bundled Cursor");
    expect(fs.readFileSync(path.join(target, "plugin", "cursor-cli-proxy.js"), "utf8")).toContain("export default");
  });

  it("skips optional dependencies when disabled", () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);
    expect(installWebUiDependencies(target, {
      browserBridge: false,
      cursorAcp: false,
      claudeAuth: false,
      commandcodeAuth: false,
    })).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(target, "opencode.jsonc"), "utf8"))).toEqual({
      $schema: "https://opencode.ai/config.json",
    });
  });

  it("copies the bundled Claude CLI Proxy plugin and runtime", () => {
    const bundle = process.env.OPENCODE_WEBUI_CLAUDE_CLI_PROXY_DIR!;
    fs.mkdirSync(path.join(bundle, "plugin"), { recursive: true });
    fs.mkdirSync(path.join(bundle, "packages", "claude-cli-proxy"), { recursive: true });
    fs.writeFileSync(path.join(bundle, "plugin", "claude-cli-proxy.js"), "export default {};");
    fs.writeFileSync(path.join(bundle, "packages", "claude-cli-proxy", "index.js"), "export default {};");
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);

    expect(installWebUiDependencies(target)).toEqual([
      "plugin/claude-cli-proxy.js",
      "packages/claude-cli-proxy",
      "plugin/commandcode-cli-proxy.js",
      "packages/commandcode-cli-proxy",
      "mcp.browser-bridge",
    ]);
    expect(fs.existsSync(path.join(target, "plugin", "claude-cli-proxy.js"))).toBe(true);
    expect(fs.existsSync(path.join(target, "packages", "claude-cli-proxy", "index.js"))).toBe(true);
  });

  it("adds the CommandCode auth plugin to a new profile", () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);

    expect(installWebUiDependencies(target, { browserBridge: false, cursorAcp: false, claudeAuth: false })).toEqual([
      "plugin/commandcode-cli-proxy.js",
      "packages/commandcode-cli-proxy",
    ]);
    expect(fs.existsSync(path.join(target, "plugin", "commandcode-cli-proxy.js"))).toBe(true);
  });

  it("removes the legacy CommandCode plugin when installing the CLI proxy", () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);
    fs.mkdirSync(path.join(target, "plugin"), { recursive: true });
    fs.mkdirSync(path.join(target, "packages", "commandcode"), { recursive: true });
    fs.writeFileSync(path.join(target, "plugin", "commandcode.js"), "export default {};");

    const installed = installWebUiDependencies(target, {
      browserBridge: false,
      cursorAcp: false,
      claudeAuth: false,
    });

    expect(installed).toContain("replaced:plugin/commandcode.js->plugin/commandcode-cli-proxy.js");
    expect(installed).toContain("replaced:packages/commandcode->packages/commandcode-cli-proxy");
    expect(fs.existsSync(path.join(target, "plugin", "commandcode.js"))).toBe(false);
    expect(fs.existsSync(path.join(target, "packages", "commandcode"))).toBe(false);
  });
});
