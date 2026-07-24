import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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

import { GET } from "./route";

let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "api-mcp-"));
  process.env.OPENCODE_CONFIG_DIR = base;
  h.ocServer.mockReset();
  h.ocServer.mockRejectedValue(new Error("engine down"));
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  fs.rmSync(base, { recursive: true, force: true });
});

describe("GET /api/extensions/mcp", () => {
  it("lists configured servers with runtime merge and masked secrets", async () => {
    fs.writeFileSync(
      path.join(base, "opencode.jsonc"),
      `{
  "mcp": {
    "blender": {
      "type": "local",
      "command": ["uvx", "blender-mcp"],
      "enabled": true,
      "env": { "API_KEY": "do-not-leak" }
    }
  }
}`,
    );
    h.ocServer.mockResolvedValueOnce({ blender: { status: "connected" } });

    const res = await GET(new NextRequest("http://localhost/api/extensions/mcp"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      servers: { name: string; runtime?: string; meta?: string }[];
    };
    expect(body.servers).toHaveLength(1);
    expect(body.servers[0]).toMatchObject({
      name: "blender",
      runtime: "connected",
      meta: "env: API_KEY",
    });
    expect(JSON.stringify(body)).not.toContain("do-not-leak");
  });

  it("returns 500 with a safe message when the config file is missing", async () => {
    const res = await GET(new NextRequest("http://localhost/api/extensions/mcp"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
    expect(body.error).not.toContain(base);
  });
});
