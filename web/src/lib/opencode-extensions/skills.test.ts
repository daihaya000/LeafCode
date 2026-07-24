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
  DEFAULT_SKILL_SCAN_LIMITS,
  listSkills,
  parseFrontmatterDescription,
  setSkillEnabled,
} from "./skills";

let base: string;

function makeSkill(root: string, name: string, body: string): void {
  const dir = path.join(base, root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), body);
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "skills-svc-"));
  process.env.OPENCODE_CONFIG_DIR = base;
  h.ocServer.mockReset();
  h.ocServer.mockRejectedValue(new Error("engine down"));
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  fs.rmSync(base, { recursive: true, force: true });
});

describe("parseFrontmatterDescription", () => {
  it("reads a plain description", () => {
    expect(
      parseFrontmatterDescription("---\nname: x\ndescription: Does things\n---\n# x"),
    ).toBe("Does things");
  });

  it("reads a quoted description", () => {
    expect(
      parseFrontmatterDescription('---\ndescription: "Quoted text"\n---\n'),
    ).toBe("Quoted text");
  });

  it("joins block-scalar lines", () => {
    const md = [
      "---",
      "name: insane-search",
      "description: >",
      "  Adaptive access for blocked websites.",
      "  Use when WebFetch returns 402/403.",
      "---",
      "",
    ].join("\n");
    expect(parseFrontmatterDescription(md)).toBe(
      "Adaptive access for blocked websites. Use when WebFetch returns 402/403.",
    );
  });

  it("truncates very long descriptions", () => {
    const md = `---\ndescription: ${"x".repeat(400)}\n---\n`;
    const out = parseFrontmatterDescription(md);
    expect(out?.length).toBe(301);
    expect(out?.endsWith("…")).toBe(true);
  });

  it("returns undefined without frontmatter or description", () => {
    expect(parseFrontmatterDescription("# no frontmatter")).toBeUndefined();
    expect(parseFrontmatterDescription("---\nname: x\n---\n")).toBeUndefined();
  });
});

describe("listSkills", () => {
  it("lists enabled and disabled skills with frontmatter descriptions", async () => {
    makeSkill("skills", "alpha", "---\ndescription: Alpha skill\n---\n");
    makeSkill("skills-disabled", "beta", "---\ndescription: Beta skill\n---\n");

    const { skills, truncated } = await listSkills();
    expect(truncated).toBe(false);
    expect(skills).toEqual([
      {
        id: "alpha",
        name: "alpha",
        description: "Alpha skill",
        enabled: true,
        toggleable: true,
      },
      {
        id: "beta",
        name: "beta",
        description: "Beta skill",
        enabled: false,
        toggleable: true,
      },
    ]);
  });

  it("returns an empty list when neither directory exists", async () => {
    expect(await listSkills()).toEqual({ skills: [], truncated: false });
  });

  it("ignores directories without SKILL.md and stray files", async () => {
    fs.mkdirSync(path.join(base, "skills", "not-a-skill"), { recursive: true });
    fs.writeFileSync(path.join(base, "skills", "README.md"), "readme");
    makeSkill("skills", "real", "---\nname: real\n---\n");

    const { skills } = await listSkills();
    expect(skills.map((s) => s.name)).toEqual(["real"]);
  });

  it("marks nested skills as view-only with relative ids", async () => {
    makeSkill("skills", "group", "---\nname: group\n---\n");
    makeSkill(path.join("skills", "group"), "inner", "---\nname: inner\n---\n");

    const { skills } = await listSkills();
    const inner = skills.find((s) => s.name === "inner");
    expect(inner).toMatchObject({
      id: "group/inner",
      enabled: true,
      toggleable: false,
    });
  });

  it("merges engine descriptions over frontmatter when available", async () => {
    makeSkill("skills", "alpha", "---\ndescription: From file\n---\n");
    h.ocServer.mockResolvedValueOnce([
      { name: "alpha", description: "From engine", content: "SHOULD NOT LEAK" },
    ]);

    const { skills } = await listSkills();
    expect(skills[0].description).toBe("From engine");
    expect(JSON.stringify(skills)).not.toContain("SHOULD NOT LEAK");
  });

  it("keeps frontmatter descriptions when the engine is unavailable", async () => {
    makeSkill("skills", "alpha", "---\ndescription: From file\n---\n");
    const { skills } = await listSkills();
    expect(skills[0].description).toBe("From file");
  });
});

describe("listing bounds", () => {
  it("stops collecting at maxSkills and reports truncation", async () => {
    for (let i = 0; i < 5; i += 1) {
      makeSkill("skills", `skill-${i}`, "---\nname: x\n---\n");
    }

    const { skills, truncated } = await listSkills({
      maxSkills: 3,
      maxScanDirs: 100,
    });
    expect(skills).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it("stops walking at maxScanDirs and reports truncation", async () => {
    for (let i = 0; i < 10; i += 1) {
      fs.mkdirSync(path.join(base, "skills", `dir-${i}`), { recursive: true });
    }
    makeSkill("skills", "real", "---\nname: real\n---\n");

    // Root + 3 children = 4 inspected dirs; the 5th hits the bound.
    const { truncated } = await listSkills({ maxSkills: 100, maxScanDirs: 4 });
    expect(truncated).toBe(true);
  });

  it("reports truncated=false when within the bounds", async () => {
    makeSkill("skills", "alpha", "---\nname: alpha\n---\n");
    const result = await listSkills({ maxSkills: 10, maxScanDirs: 10 });
    expect(result).toEqual({
      skills: [
        expect.objectContaining({ id: "alpha", enabled: true }),
      ],
      truncated: false,
    });
  });

  it("exports positive default bounds", () => {
    expect(DEFAULT_SKILL_SCAN_LIMITS.maxSkills).toBeGreaterThan(0);
    expect(DEFAULT_SKILL_SCAN_LIMITS.maxScanDirs).toBeGreaterThan(0);
  });
});

describe("setSkillEnabled", () => {
  it("disables a skill by moving skills/<name> to skills-disabled/<name>", async () => {
    makeSkill("skills", "alpha", "---\nname: alpha\n---\n");

    await setSkillEnabled("alpha", false);

    expect(fs.existsSync(path.join(base, "skills", "alpha"))).toBe(false);
    expect(
      fs.existsSync(path.join(base, "skills-disabled", "alpha", "SKILL.md")),
    ).toBe(true);
  });

  it("enables a skill by moving it back", async () => {
    makeSkill("skills-disabled", "beta", "---\nname: beta\n---\n");

    await setSkillEnabled("beta", true);

    expect(fs.existsSync(path.join(base, "skills-disabled", "beta"))).toBe(false);
    expect(fs.existsSync(path.join(base, "skills", "beta", "SKILL.md"))).toBe(true);
  });

  it("fails on name conflict without losing either copy", async () => {
    makeSkill("skills", "alpha", "enabled-copy");
    makeSkill("skills-disabled", "alpha", "disabled-copy");

    await expect(setSkillEnabled("alpha", false)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      fs.readFileSync(path.join(base, "skills", "alpha", "SKILL.md"), "utf8"),
    ).toBe("enabled-copy");
    expect(
      fs.readFileSync(
        path.join(base, "skills-disabled", "alpha", "SKILL.md"),
        "utf8",
      ),
    ).toBe("disabled-copy");
  });

  it("rejects unknown skills", async () => {
    await expect(setSkillEnabled("ghost", false)).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("refuses to move directories that are not skills", async () => {
    fs.mkdirSync(path.join(base, "skills", "plain-dir"), { recursive: true });
    await expect(setSkillEnabled("plain-dir", false)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(fs.existsSync(path.join(base, "skills", "plain-dir"))).toBe(true);
  });

  it.each(["../escape", "a/b", "..", ".hidden", "CON"])(
    "rejects unsafe names: %s",
    async (name) => {
      await expect(setSkillEnabled(name, false)).rejects.toMatchObject({
        code: "invalid-name",
      });
    },
  );
});
