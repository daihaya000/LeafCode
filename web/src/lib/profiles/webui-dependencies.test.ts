import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installWebUiDependencies, migrateProviderIds } from "./webui-dependencies";

const dirs: string[] = [];
let previousConfigDir: string | undefined;
let previousCursorCliProxyDir: string | undefined;
let previousClaudeCliProxyDir: string | undefined;
let previousCommandcodeCliProxyDir: string | undefined;
let previousRoot: string | undefined;

beforeEach(() => {
  previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
  previousCursorCliProxyDir = process.env.LEAFCODE_CURSOR_CLI_PROXY_DIR;
  previousClaudeCliProxyDir = process.env.LEAFCODE_CLAUDE_CLI_PROXY_DIR;
  previousCommandcodeCliProxyDir = process.env.LEAFCODE_COMMANDCODE_CLI_PROXY_DIR;
  previousRoot = process.env.LEAFCODE_ROOT;
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-source-"));
  dirs.push(source);
  process.env.OPENCODE_CONFIG_DIR = source;
  process.env.LEAFCODE_CURSOR_CLI_PROXY_DIR = path.join(source, "bundled");
  process.env.LEAFCODE_CLAUDE_CLI_PROXY_DIR = path.join(source, "claude-bundled");
  process.env.LEAFCODE_COMMANDCODE_CLI_PROXY_DIR = path.join(source, "commandcode-bundled");
  process.env.LEAFCODE_ROOT = source;
  fs.mkdirSync(path.join(source, "commandcode-bundled", "plugin"), { recursive: true });
  fs.mkdirSync(path.join(source, "commandcode-bundled", "packages", "commandcode-cli-proxy"), { recursive: true });
  fs.writeFileSync(path.join(source, "commandcode-bundled", "plugin", "commandcode-cli-proxy.js"), "export default {};");
  fs.writeFileSync(path.join(source, "commandcode-bundled", "packages", "commandcode-cli-proxy", "index.mjs"), "export default {};");
  fs.mkdirSync(path.join(source, "vendor", "commandcode-cli-proxy", "plugin"), { recursive: true });
  fs.mkdirSync(path.join(source, "vendor", "commandcode-cli-proxy", "packages", "commandcode-cli-proxy"), { recursive: true });
  fs.writeFileSync(path.join(source, "vendor", "commandcode-cli-proxy", "plugin", "commandcode-cli-proxy.js"), "export default {};");
  fs.writeFileSync(path.join(source, "vendor", "commandcode-cli-proxy", "packages", "commandcode-cli-proxy", "index.mjs"), "export default {};");
});

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
  else process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
  if (previousCursorCliProxyDir === undefined) delete process.env.LEAFCODE_CURSOR_CLI_PROXY_DIR;
  else process.env.LEAFCODE_CURSOR_CLI_PROXY_DIR = previousCursorCliProxyDir;
  if (previousClaudeCliProxyDir === undefined) delete process.env.LEAFCODE_CLAUDE_CLI_PROXY_DIR;
  else process.env.LEAFCODE_CLAUDE_CLI_PROXY_DIR = previousClaudeCliProxyDir;
  if (previousCommandcodeCliProxyDir === undefined) delete process.env.LEAFCODE_COMMANDCODE_CLI_PROXY_DIR;
  else process.env.LEAFCODE_COMMANDCODE_CLI_PROXY_DIR = previousCommandcodeCliProxyDir;
  if (previousRoot === undefined) delete process.env.LEAFCODE_ROOT;
  else process.env.LEAFCODE_ROOT = previousRoot;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("installWebUiDependencies", () => {
  it("adds the Browser Bridge MCP entry to a new profile", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-"));
    dirs.push(dir);

    expect(installWebUiDependencies(dir, { commandcodeAuth: false })).toEqual(["mcp.browser-bridge"]);
    const config = JSON.parse(fs.readFileSync(path.join(dir, "opencode.jsonc"), "utf8"));
    expect(config.mcp["browser-bridge"].command[0]).toBe("node");
    expect(config.mcp["browser-bridge"].command[1]).toBe(
      path.join(process.env.LEAFCODE_ROOT!, "browser-bridge", "mcp", "server.mjs"),
    );
    expect(config.mcp["browser-bridge"].environment).toEqual({
      LEAFCODE_BROWSER_BROKER: "{env:LEAFCODE_BROWSER_BROKER}",
      LEAFCODE_BROWSER_BROKER_TOKEN: "{env:LEAFCODE_BROWSER_BROKER_TOKEN}",
    });
  });

  it("resolves Browser Bridge next to a production web directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-root-"));
    const webDir = path.join(root, "web");
    const serverPath = path.join(root, "browser-bridge", "mcp", "server.mjs");
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(root, target);
    fs.mkdirSync(webDir, { recursive: true });
    fs.mkdirSync(path.dirname(serverPath), { recursive: true });
    fs.writeFileSync(serverPath, "");

    const previousCwd = process.cwd();
    const configuredRoot = process.env.LEAFCODE_ROOT;
    delete process.env.LEAFCODE_ROOT;
    process.chdir(webDir);
    try {
      installWebUiDependencies(target, { commandcodeAuth: false });
    } finally {
      process.chdir(previousCwd);
      if (configuredRoot === undefined) delete process.env.LEAFCODE_ROOT;
      else process.env.LEAFCODE_ROOT = configuredRoot;
    }

    const config = JSON.parse(fs.readFileSync(path.join(target, "opencode.jsonc"), "utf8"));
    expect(config.mcp["browser-bridge"].command[1]).toBe(serverPath);
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
      JSON.stringify({ provider: { "cursor": { name: "Cursor", models: { auto: {} } } } }),
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
    expect(installed).toContain("provider.cursor");
    expect(fs.existsSync(path.join(target, "packages", "cursor-cli-proxy", "index.js"))).toBe(true);
    const config = JSON.parse(fs.readFileSync(path.join(target, "opencode.jsonc"), "utf8"));
    expect(config.provider["cursor"].name).toBe("Cursor");
  });

  it("uses the repository bundle when the active profile has no Cursor CLI Proxy", () => {
    const bundle = process.env.LEAFCODE_CURSOR_CLI_PROXY_DIR!;
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(
      path.join(bundle, "opencode.jsonc"),
      JSON.stringify({ provider: { "cursor": { name: "Bundled Cursor" } } }),
    );
    fs.mkdirSync(path.join(bundle, "plugin"), { recursive: true });
    fs.writeFileSync(path.join(bundle, "plugin", "cursor-cli-proxy.js"), "export default {};\n");
    fs.mkdirSync(path.join(bundle, "packages", "cursor-cli-proxy"), { recursive: true });
    fs.writeFileSync(path.join(bundle, "packages", "cursor-cli-proxy", "index.js"), "export default {};\n");

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);
    installWebUiDependencies(target, { commandcodeAuth: false });

    const config = JSON.parse(fs.readFileSync(path.join(target, "opencode.jsonc"), "utf8"));
    expect(config.provider["cursor"].name).toBe("Bundled Cursor");
    expect(fs.readFileSync(path.join(target, "plugin", "cursor-cli-proxy.js"), "utf8")).toContain("export default");
  });

  it("updates the bundle when the active profile is the target reached through a link", () => {
    const bundle = process.env.LEAFCODE_CURSOR_CLI_PROXY_DIR!;
    const bundlePackage = path.join(bundle, "packages", "cursor-cli-proxy", "index.js");
    fs.mkdirSync(path.join(bundle, "plugin"), { recursive: true });
    fs.mkdirSync(path.join(bundle, "packages", "cursor-cli-proxy"), { recursive: true });
    fs.writeFileSync(path.join(bundle, "plugin", "cursor-cli-proxy.js"), "export default {};\n");
    fs.writeFileSync(bundlePackage, "export const version = 'old';\n");

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);
    installWebUiDependencies(target, { commandcodeAuth: false });

    // Ship a newer bundle, then point the active profile dir at the target
    // through a link, the way `~/.config/opencode` refers to a profile.
    fs.writeFileSync(bundlePackage, "export const version = 'new';\n");
    const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-link-")), "active");
    dirs.push(path.dirname(link));
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    process.env.OPENCODE_CONFIG_DIR = link;

    const installed = installWebUiDependencies(target, { commandcodeAuth: false });

    expect(installed).toContain("packages/cursor-cli-proxy");
    expect(fs.readFileSync(path.join(target, "packages", "cursor-cli-proxy", "index.js"), "utf8")).toContain("'new'");
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
    const bundle = process.env.LEAFCODE_CLAUDE_CLI_PROXY_DIR!;
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

  it("adds the bundled Anthropic provider definition when Claude CLI Proxy is enabled", () => {
    const bundle = process.env.LEAFCODE_CLAUDE_CLI_PROXY_DIR!;
    fs.mkdirSync(path.join(bundle, "plugin"), { recursive: true });
    fs.mkdirSync(path.join(bundle, "packages", "claude-cli-proxy"), { recursive: true });
    fs.writeFileSync(path.join(bundle, "plugin", "claude-cli-proxy.js"), "export default {};");
    fs.writeFileSync(path.join(bundle, "packages", "claude-cli-proxy", "index.js"), "export default {};");
    fs.writeFileSync(
      path.join(bundle, "opencode.jsonc"),
      JSON.stringify({
        provider: {
          anthropic: {
            name: "Bundled Anthropic",
            npm: "@ai-sdk/anthropic",
            whitelist: ["claude-sonnet-5"],
            models: { "claude-sonnet-5": { limit: { context: 200000 } } },
          },
        },
      }),
    );
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);

    expect(installWebUiDependencies(target, { browserBridge: false, cursorAcp: false, commandcodeAuth: false })).toEqual([
      "plugin/claude-cli-proxy.js",
      "packages/claude-cli-proxy",
      "provider.anthropic",
    ]);
    const config = JSON.parse(fs.readFileSync(path.join(target, "opencode.jsonc"), "utf8"));
    expect(config.provider.anthropic.name).toBe("Bundled Anthropic");
    expect(config.provider.anthropic.whitelist).toEqual(["claude-sonnet-5"]);
  });

  it("does not overwrite an existing Anthropic provider configuration", () => {
    const bundle = process.env.LEAFCODE_CLAUDE_CLI_PROXY_DIR!;
    fs.mkdirSync(path.join(bundle, "plugin"), { recursive: true });
    fs.mkdirSync(path.join(bundle, "packages", "claude-cli-proxy"), { recursive: true });
    fs.writeFileSync(path.join(bundle, "plugin", "claude-cli-proxy.js"), "export default {};");
    fs.writeFileSync(path.join(bundle, "packages", "claude-cli-proxy", "index.js"), "export default {};");
    fs.writeFileSync(
      path.join(bundle, "opencode.jsonc"),
      JSON.stringify({
        provider: {
          anthropic: {
            name: "Bundled Anthropic",
            npm: "@ai-sdk/anthropic",
            whitelist: ["claude-sonnet-5"],
            models: { "claude-sonnet-5": { limit: { context: 200000 } } },
          },
        },
      }),
    );
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);
    const configPath = path.join(target, "opencode.jsonc");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ provider: { anthropic: { name: "Existing Anthropic", whitelist: ["claude-opus-5"] } } }),
    );

    expect(installWebUiDependencies(target, { browserBridge: false, cursorAcp: false, commandcodeAuth: false })).toEqual([
      "plugin/claude-cli-proxy.js",
      "packages/claude-cli-proxy",
    ]);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.provider.anthropic.name).toBe("Existing Anthropic");
    expect(config.provider.anthropic.whitelist).toEqual(["claude-opus-5"]);
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

  it("copies the CommandCode plugin from the env-override bundle dir", () => {
    const bundle = process.env.LEAFCODE_COMMANDCODE_CLI_PROXY_DIR!;
    fs.mkdirSync(path.join(bundle, "plugin"), { recursive: true });
    fs.mkdirSync(path.join(bundle, "packages", "commandcode-cli-proxy"), { recursive: true });
    fs.writeFileSync(path.join(bundle, "plugin", "commandcode-cli-proxy.js"), "export default 'from-bundle';\n");
    fs.writeFileSync(path.join(bundle, "packages", "commandcode-cli-proxy", "index.mjs"), "export default 'from-bundle';\n");

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);
    installWebUiDependencies(target, { browserBridge: false, cursorAcp: false, claudeAuth: false });

    expect(fs.readFileSync(path.join(target, "plugin", "commandcode-cli-proxy.js"), "utf8")).toContain("from-bundle");
    expect(fs.readFileSync(path.join(target, "packages", "commandcode-cli-proxy", "index.mjs"), "utf8")).toContain("from-bundle");
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

  it("updates an already-installed CommandCode CLI Proxy when the bundle hash changes", () => {
    const bundle = process.env.LEAFCODE_COMMANDCODE_CLI_PROXY_DIR!;
    const indexPath = path.join(bundle, "packages", "commandcode-cli-proxy", "index.mjs");
    const src = fs.readFileSync(indexPath, "utf8");

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-update-"));
    dirs.push(target);

    installWebUiDependencies(target, { browserBridge: false, cursorAcp: false, claudeAuth: false });

    // Same bundle 竊・no re-install on second run (idempotent).
    const secondRound = installWebUiDependencies(target, { browserBridge: false, cursorAcp: false, claudeAuth: false });
    expect(secondRound).toEqual([]);

    // Bundle content changes 竊・existing profile is updated.
    fs.writeFileSync(indexPath, src + "\n// updated\n");

    const thirdRound = installWebUiDependencies(target, { browserBridge: false, cursorAcp: false, claudeAuth: false });
    expect(thirdRound).toContain("packages/commandcode-cli-proxy");
    expect(fs.readFileSync(path.join(target, "packages", "commandcode-cli-proxy", "index.mjs"), "utf8")).toContain("// updated");
  });

  it("records and reuses the installed CommandCode version marker", () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-marker-"));
    dirs.push(target);

    installWebUiDependencies(target, { browserBridge: false, cursorAcp: false, claudeAuth: false });

    const marker = JSON.parse(fs.readFileSync(path.join(target, ".webui-vendor-versions.json"), "utf8"));
    expect(marker).toHaveProperty("plugin/commandcode-cli-proxy.js");
    expect(marker).toHaveProperty("packages/commandcode-cli-proxy");

    // A profile without the marker still gets the file re-copied (legacy upgrade path).
    fs.rmSync(path.join(target, ".webui-vendor-versions.json"), { force: true });
    const legacyRound = installWebUiDependencies(target, { browserBridge: false, cursorAcp: false, claudeAuth: false });
    expect(legacyRound).toContain("packages/commandcode-cli-proxy");
  });

  it("migrates provider.cursor-acp to cursor and agent model references", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-migrate-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "opencode.jsonc"),
      JSON.stringify({ provider: { "cursor-acp": { name: "Cursor" } } }),
    );
    fs.writeFileSync(
      path.join(dir, "agents", "worker.md"),
      "---\nmodel: cursor-acp::auto\ndescription: cursor worker\n---\n",
    );

    const installed = migrateProviderIds(dir);

    expect(installed).toContain("migrated:provider.cursor-acp->cursor");
    expect(installed).toContain("migrated:agent-model:agents/worker.md");
    const config = JSON.parse(fs.readFileSync(path.join(dir, "opencode.jsonc"), "utf8"));
    expect(config.provider["cursor"].name).toBe("Cursor");
    expect(config.provider["cursor-acp"]).toBeUndefined();
    const agent = fs.readFileSync(path.join(dir, "agents", "worker.md"), "utf8");
    expect(agent).toContain("model: cursor::auto");
    expect(agent).not.toContain("cursor-acp::");
  });
});

describe("vendored plugin self-containment", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const vendorPlugins = [
    ["cursor-cli-proxy", "packages/cursor-cli-proxy/index.js"],
    ["claude-cli-proxy", "packages/claude-cli-proxy/dist/index.js"],
    ["commandcode-cli-proxy", "packages/commandcode-cli-proxy/index.mjs"],
  ] as const;

  for (const [vendorName, relPath] of vendorPlugins) {
    it(`${vendorName} bundled file has no external npm imports (fully self-contained)`, () => {
      const filePath = path.join(repoRoot, "vendor", vendorName, relPath);
      if (!fs.existsSync(filePath)) return; // skip if not installed
      const src = fs.readFileSync(filePath, "utf8");
      // Strip BOM
      const content = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
      // Find all import ... from "..." statements
      const importRegex = /^\s*import\s.*?\sfrom\s+"([^"]+)"/gm;
      const imports: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = importRegex.exec(content)) !== null) {
        imports.push(m[1]);
      }
      // All imports must be node: builtins or relative paths
      const external = imports.filter(
        (spec) => !spec.startsWith("node:") && !spec.startsWith(".") && !spec.startsWith("/"),
      );
      expect(external).toEqual([]);
    });

    it(`${vendorName} bundled file passes node --check`, () => {
      const filePath = path.join(repoRoot, "vendor", vendorName, relPath);
      if (!fs.existsSync(filePath)) return; // skip if not installed
      const result = spawnSync("node", ["--check", filePath], {
        encoding: "utf8",
        timeout: 10000,
      });
      // node --check may warn about ESM; only fail on SyntaxError
      if (result.status !== 0) {
        // ESM warning is fine, real syntax errors are not
        const stderr = result.stderr || "";
        if (/SyntaxError/.test(stderr)) {
          throw new Error(`SyntaxError in ${filePath}:\n${stderr}`);
        }
      }
    });
  }
});
