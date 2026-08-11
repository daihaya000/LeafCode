import { describe, expect, it } from "vitest";
import { isDistributableMcpServer, parseJsonSettings } from "./sync-engine";
import { stripJsonc } from "./jsonc";

describe("MCP profile distribution", () => {
  it("excludes the WebUI-only browser bridge", () => {
    expect(isDistributableMcpServer("browser-bridge")).toBe(false);
    expect(isDistributableMcpServer("qwen-mm-plugins-core")).toBe(true);
  });

  it("accepts JSONC trailing commas", () => {
    expect(JSON.parse(stripJsonc('{"mcp": {"server": {},},}'))).toEqual({
      mcp: { server: {} },
    });
  });

  it("treats an empty target settings file as empty settings", () => {
    expect(parseJsonSettings("\n  ")).toEqual({});
  });
});
