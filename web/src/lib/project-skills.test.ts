import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteProjectSkill,
  listProjectSkills,
  readProjectSkill,
  writeProjectSkill,
} from "./project-skills";

const roots: string[] = [];

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-skills-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("project skills", () => {
  it("creates, lists, reads, updates, and deletes SKILL.md", () => {
    const root = createRoot();
    const created = writeProjectSkill(root, "reviewer", "initial");

    expect(created.relativePath).toBe(".opencode/skills/reviewer/SKILL.md");
    expect(listProjectSkills(root)).toEqual([created]);
    expect(readProjectSkill(root, "reviewer").content).toBe("initial");

    writeProjectSkill(root, "reviewer", "updated");
    expect(readProjectSkill(root, "reviewer").content).toBe("updated");

    deleteProjectSkill(root, "reviewer");
    expect(listProjectSkills(root)).toEqual([]);
  });

  it("rejects unsafe skill names", () => {
    const root = createRoot();
    expect(() => writeProjectSkill(root, "../outside", "content")).toThrow(
      "スキル名は英数字",
    );
  });

  it.runIf(process.platform !== "win32")("rejects a symlinked skills directory", () => {
    const root = createRoot();
    const outside = createRoot();
    fs.mkdirSync(path.join(root, ".opencode"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".opencode", "skills"), "dir");

    expect(() => writeProjectSkill(root, "reviewer", "content")).toThrow(
      "シンボリックリンク",
    );
    expect(fs.existsSync(path.join(outside, "reviewer"))).toBe(false);
  });
});
