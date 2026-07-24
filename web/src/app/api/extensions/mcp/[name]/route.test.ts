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

import { PATCH } from "./route";

const CONFIG = `{
  // keep me
  "mcp": {
    "blender": { "type": "local", "command": ["uvx"], "enabled": true }
  }
}
`;

let base: string;

function request(name: string, body: unknown): Promise<Response> {
  return PATCH(
    new NextRequest(
      `http://localhost/api/extensions/mcp/${encodeURIComponent(name)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
    { params: Promise.resolve({ name }) },
  );
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "api-mcp-toggle-"));
  process.env.OPENCODE_CONFIG_DIR = base;
  fs.writeFileSync(path.join(base, "opencode.jsonc"), CONFIG);
  h.ocServer.mockReset();
  h.ocServer.mockRejectedValue(new Error("engine down"));
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  fs.rmSync(base, { recursive: true, force: true });
});

describe("PATCH /api/extensions/mcp/[name]", () => {
  it("toggles only the targeted enabled flag, preserving comments", async () => {
    const res = await request("blender", { enabled: false });
    expect(res.status).toBe(200);

    const out = fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8");
    expect(out).toContain("// keep me");
    expect(out).toContain('"enabled": false');
  });

  it("returns 400 for a malformed body", async () => {
    const res = await request("blender", {});
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown server", async () => {
    const res = await request("ghost", { enabled: false });
    expect(res.status).toBe(404);
  });
});
