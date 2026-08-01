import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installWebUiDependencies } from "./webui-dependencies";

const dirs: string[] = [];
let previousConfigDir: string | undefined;

beforeEach(() => {
  previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-source-"));
  dirs.push(source);
  process.env.OPENCODE_CONFIG_DIR = source;
});

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
  else process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("installWebUiDependencies", () => {
  it("adds the Browser Bridge MCP entry to a new profile", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-"));
    dirs.push(dir);

    expect(installWebUiDependencies(dir)).toEqual(["mcp.browser-bridge"]);
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

    expect(installWebUiDependencies(dir)).toEqual([]);
    expect(fs.readFileSync(configPath, "utf8")).toContain("custom");
  });

  it("copies Cursor ACP plugin files and provider settings from the active profile", () => {
    const source = process.env.OPENCODE_CONFIG_DIR!;
    fs.writeFileSync(
      path.join(source, "opencode.jsonc"),
      JSON.stringify({ provider: { "cursor-acp": { name: "Cursor", models: { auto: {} } } } }),
    );
    fs.mkdirSync(path.join(source, "plugin"), { recursive: true });
    fs.writeFileSync(path.join(source, "plugin", "cursor-acp.js"), "export default {};\n");
    fs.mkdirSync(path.join(source, "packages", "cursor-acp"), { recursive: true });
    fs.writeFileSync(path.join(source, "packages", "cursor-acp", "index.js"), "export default {};\n");

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "profile-deps-target-"));
    dirs.push(target);
    const installed = installWebUiDependencies(target);

    expect(installed).toContain("plugin/cursor-acp.js");
    expect(installed).toContain("packages/cursor-acp");
    expect(installed).toContain("provider.cursor-acp");
    expect(fs.existsSync(path.join(target, "packages", "cursor-acp", "index.js"))).toBe(true);
    const config = JSON.parse(fs.readFileSync(path.join(target, "opencode.jsonc"), "utf8"));
    expect(config.provider["cursor-acp"].name).toBe("Cursor");
  });
});
