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

import { GET } from "./route";

let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "api-skills-"));
  process.env.OPENCODE_CONFIG_DIR = base;
  h.ocServer.mockReset();
  h.ocServer.mockRejectedValue(new Error("engine down"));
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  fs.rmSync(base, { recursive: true, force: true });
});

describe("GET /api/extensions/skills", () => {
  it("lists enabled and disabled global skills", async () => {
    fs.mkdirSync(path.join(base, "skills", "alpha"), { recursive: true });
    fs.writeFileSync(
      path.join(base, "skills", "alpha", "SKILL.md"),
      "---\ndescription: A\n---\n",
    );
    fs.mkdirSync(path.join(base, "skills-disabled", "beta"), { recursive: true });
    fs.writeFileSync(
      path.join(base, "skills-disabled", "beta", "SKILL.md"),
      "---\ndescription: B\n---\n",
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      skills: { id: string; name: string; description?: string; enabled: boolean; toggleable: boolean }[];
      truncated: boolean;
    };
    expect(body.truncated).toBe(false);
    expect(
      body.skills.map(({ id, enabled, toggleable }) => ({ id, enabled, toggleable })),
    ).toEqual([
      { id: "alpha", enabled: true, toggleable: true },
      { id: "beta", enabled: false, toggleable: true },
    ]);
    expect(body.skills[0].description).toBe("A");
  });

  it("returns an empty list when no skill directories exist", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skills: [], truncated: false });
  });
});
