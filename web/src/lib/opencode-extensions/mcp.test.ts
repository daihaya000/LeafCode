import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ ocServer: vi.fn() }));

vi.mock("@/lib/oc-server", () => ({
  ocServer: h.ocServer,
  OcError: class OcError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import {
  listMcpServers,
  maskCommandArgs,
  maskUrl,
  setMcpEnabled,
} from "./mcp";

const CONFIG = `{
  // top comment
  "mcp": {
    // local server comment
    "blender": {
      "type": "local",
      "command": ["uvx", "blender-mcp"],
      "enabled": true,
      "env": { "BLENDER_PORT": "9999", "API_KEY": "super-secret" }
    },
    "github": {
      "type": "remote",
      "url": "https://user:hunter2@example.com/mcp?token=abc123&team=core",
      "headers": { "Authorization": "Bearer xyz" }
    },
    "legacy": { "enabled": false }
  },
  "model": "openai/gpt-5.6-terra"
}
`;

let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-svc-"));
  process.env.OPENCODE_CONFIG_DIR = base;
  fs.writeFileSync(path.join(base, "opencode.jsonc"), CONFIG);
  h.ocServer.mockReset();
  h.ocServer.mockRejectedValue(new Error("engine down"));
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  fs.rmSync(base, { recursive: true, force: true });
});

describe("secret masking", () => {
  it("masks credential-looking command arguments only", () => {
    expect(maskCommandArgs(["npx", "server", "--token=abc"])).toBe(
      "npx server --token=***",
    );
    expect(maskCommandArgs(["uvx", "blender-mcp"])).toBe("uvx blender-mcp");
    expect(maskCommandArgs("not-an-array")).toBe("");
  });

  it("masks URL userinfo and secret query params", () => {
    const out = maskUrl("https://user:hunter2@example.com/mcp?token=abc&team=core");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("abc");
    expect(out).toContain("***@example.com");
    expect(out).toContain("team=core");
  });

  it("never returns the raw value for unparseable URLs", () => {
    expect(maskUrl("https://user:pass@bad url")).toBe("(URL)");
    expect(maskUrl(undefined)).toBe("");
  });
});

describe("listMcpServers", () => {
  it("lists configured servers without leaking secret values", async () => {
    const servers = await listMcpServers();
    const byName = Object.fromEntries(servers.map((s) => [s.name, s]));

    expect(servers.map((s) => s.name)).toEqual(["blender", "github", "legacy"]);

    expect(byName.blender).toMatchObject({
      type: "local",
      detail: "uvx blender-mcp",
      meta: "env: BLENDER_PORT, API_KEY",
      enabled: true,
    });
    expect(byName.github.type).toBe("remote");
    expect(byName.github.detail).toContain("***@example.com");
    expect(byName.github.meta).toBe("headers: Authorization");
    expect(byName.legacy.enabled).toBe(false);

    const serialized = JSON.stringify(servers);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("Bearer xyz");
    expect(serialized).not.toContain("abc123");
  });

  it("merges runtime statuses from the engine", async () => {
    h.ocServer.mockResolvedValueOnce({
      blender: { status: "connected" },
      github: { status: "needs_auth" },
      legacy: { status: "disabled" },
    });
    const servers = await listMcpServers();
    const byName = Object.fromEntries(servers.map((s) => [s.name, s]));
    expect(byName.blender).toMatchObject({
      runtime: "connected",
      engineAvailable: true,
      pendingRestart: false,
    });
    expect(byName.github.runtime).toBe("needs_auth");
    expect(byName.legacy.runtime).toBe("disabled");
  });

  it("flags config/runtime mismatches as pendingRestart", async () => {
    h.ocServer.mockResolvedValueOnce({
      blender: { status: "disabled" }, // enabled in config, disabled at runtime
      github: { status: "connected" }, // disabled in config (no enabled:false? github has none → enabled)
      legacy: { status: "connected" }, // disabled in config, still running
    });
    const servers = await listMcpServers();
    const byName = Object.fromEntries(servers.map((s) => [s.name, s]));
    expect(byName.blender.pendingRestart).toBe(true);
    expect(byName.github.pendingRestart).toBe(false);
    expect(byName.legacy.pendingRestart).toBe(true);
  });

  it("reports engineAvailable=false when the engine is down", async () => {
    const servers = await listMcpServers();
    expect(servers.every((s) => s.engineAvailable === false)).toBe(true);
    expect(servers.every((s) => s.pendingRestart === false)).toBe(true);
    expect(servers.every((s) => s.runtime === undefined)).toBe(true);
  });

  it("returns an empty list when mcp is absent", async () => {
    fs.writeFileSync(path.join(base, "opencode.jsonc"), '{ "model": "x" }');
    expect(await listMcpServers()).toEqual([]);
  });

  it("raises a safe error when the config file is missing", async () => {
    fs.rmSync(path.join(base, "opencode.jsonc"));
    await expect(listMcpServers()).rejects.toThrowError(/見つかりません/);
  });
});

describe("setMcpEnabled", () => {
  it("updates only the targeted enabled value, preserving comments", async () => {
    await setMcpEnabled("blender", false);

    const out = fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8");
    expect(out).toContain("// top comment");
    expect(out).toContain("// local server comment");
    expect(out).toContain('"model": "openai/gpt-5.6-terra"');
    // Only the blender enabled line changed.
    const diff = CONFIG.split("\n").filter(
      (line, i) => line !== out.split("\n")[i],
    );
    expect(diff).toEqual(['      "enabled": true,']);
    expect(out).toMatch(/"blender": \{[\s\S]*?"enabled": false/);
  });

  it("enables a disabled server", async () => {
    await setMcpEnabled("legacy", true);
    const out = fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8");
    expect(out).toContain('"enabled": true');
    expect(out).toMatch(/"legacy": \{[\s\S]*?"enabled": true/);
  });

  it("leaves the file untouched when the value already matches", async () => {
    const before = fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8");
    await setMcpEnabled("blender", true);
    expect(fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8")).toBe(
      before,
    );
  });

  it("rejects unknown servers without writing", async () => {
    const before = fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8");
    await expect(setMcpEnabled("ghost", false)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8")).toBe(
      before,
    );
  });

  it("rejects invalid names", async () => {
    await expect(setMcpEnabled("", false)).rejects.toMatchObject({
      code: "invalid-name",
    });
    await expect(setMcpEnabled("a\x00b", false)).rejects.toMatchObject({
      code: "invalid-name",
    });
  });
});
