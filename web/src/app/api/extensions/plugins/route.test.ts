import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dataDir: "" }));

vi.mock("@/lib/paths", () => ({
  dataDir: () => h.dataDir,
  ensureDataDir: () => undefined,
}));

import { GET, POST } from "./route";

let base: string;
let data: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "api-plugins-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "api-plugins-data-"));
  process.env.OPENCODE_CONFIG_DIR = base;
  h.dataDir = data;
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
});

describe("GET /api/extensions/plugins", () => {
  it("lists configured and local plugins", async () => {
    fs.writeFileSync(
      path.join(base, "opencode.jsonc"),
      `{ "plugin": ["opencode-claude-auth@latest"] }`,
    );
    fs.mkdirSync(path.join(base, "plugin"));
    fs.writeFileSync(path.join(base, "plugin", "cursor-acp.js"), "x");

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plugins: { id: string; name: string; kind: string; enabled: boolean }[];
    };
    expect(body.plugins).toEqual([
      {
        id: expect.stringMatching(/^config:[0-9a-f]{16}\.0$/),
        name: "opencode-claude-auth@latest",
        kind: "config",
        enabled: true,
      },
      { id: "local:cursor-acp.js", name: "cursor-acp.js", kind: "local", enabled: true },
    ]);
  });

  it("returns 500 with a safe message when the config file is missing", async () => {
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain(base);
  });
});

describe("POST /api/extensions/plugins", () => {
  it("registers a plugin with options", async () => {
    fs.writeFileSync(path.join(base, "opencode.jsonc"), "{}\n");

    const res = await POST(
      new Request("http://localhost/api/extensions/plugins", {
        method: "POST",
        body: JSON.stringify({
          name: "opencode-new-plugin",
          options: { apiKey: "abc" },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, requiresRestart: true });
    const config = JSON.parse(
      fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8"),
    );
    expect(config.plugin).toEqual([["opencode-new-plugin", { apiKey: "abc" }]]);
  });

  it("rejects a non-string name with 400", async () => {
    fs.writeFileSync(path.join(base, "opencode.jsonc"), "{}\n");

    const res = await POST(
      new Request("http://localhost/api/extensions/plugins", {
        method: "POST",
        body: JSON.stringify({ name: 123 }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("returns a safe error message for a blank name", async () => {
    fs.writeFileSync(path.join(base, "opencode.jsonc"), "{}\n");

    const res = await POST(
      new Request("http://localhost/api/extensions/plugins", {
        method: "POST",
        body: JSON.stringify({ name: "   " }),
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("プラグイン名を入力してください");
  });
});
