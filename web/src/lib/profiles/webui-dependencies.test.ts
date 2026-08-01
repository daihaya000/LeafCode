import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installWebUiDependencies } from "./webui-dependencies";

const dirs: string[] = [];

afterEach(() => {
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
});
