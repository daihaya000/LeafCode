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

let base: string;

function request(name: string, body: unknown): Promise<Response> {
  return PATCH(
    new NextRequest(`http://localhost/api/extensions/skills/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ name }) },
  );
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "api-skills-toggle-"));
  process.env.OPENCODE_CONFIG_DIR = base;
  h.ocServer.mockReset();
  h.ocServer.mockRejectedValue(new Error("engine down"));
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  fs.rmSync(base, { recursive: true, force: true });
});

describe("PATCH /api/extensions/skills/[name]", () => {
  it("disables a skill by moving it to skills-disabled", async () => {
    fs.mkdirSync(path.join(base, "skills", "alpha"), { recursive: true });
    fs.writeFileSync(path.join(base, "skills", "alpha", "SKILL.md"), "---\n---\n");

    const res = await request("alpha", { enabled: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fs.existsSync(path.join(base, "skills-disabled", "alpha", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(base, "skills", "alpha"))).toBe(false);
  });

  it("enables a skill by moving it back", async () => {
    fs.mkdirSync(path.join(base, "skills-disabled", "beta"), { recursive: true });
    fs.writeFileSync(path.join(base, "skills-disabled", "beta", "SKILL.md"), "---\n---\n");

    const res = await request("beta", { enabled: true });
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(base, "skills", "beta", "SKILL.md"))).toBe(true);
  });

  it("returns 400 for a non-boolean body", async () => {
    const res = await request("alpha", { enabled: "yes" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for traversal names", async () => {
    const res = await request("..", { enabled: false });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown skill", async () => {
    const res = await request("ghost", { enabled: false });
    expect(res.status).toBe(404);
  });

  it("returns 409 on a name conflict and keeps both copies", async () => {
    fs.mkdirSync(path.join(base, "skills", "alpha"), { recursive: true });
    fs.writeFileSync(path.join(base, "skills", "alpha", "SKILL.md"), "src");
    fs.mkdirSync(path.join(base, "skills-disabled", "alpha"), { recursive: true });
    fs.writeFileSync(path.join(base, "skills-disabled", "alpha", "SKILL.md"), "dst");

    const res = await request("alpha", { enabled: false });
    expect(res.status).toBe(409);
    expect(fs.readFileSync(path.join(base, "skills", "alpha", "SKILL.md"), "utf8")).toBe("src");
  });
});
