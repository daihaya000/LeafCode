import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteAgentFile,
  listAgentFiles,
  readAgentFile,
  setAgentFileEnabled,
  writeAgentFile,
} from "./agent-files";

let base: string;

function write(dir: string, name: string, body: string): string {
  const target = path.join(base, dir);
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, `${name}.md`);
  fs.writeFileSync(file, body, "utf8");
  return file;
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agent-files-"));
  process.env.OPENCODE_CONFIG_DIR = base;
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  fs.rmSync(base, { recursive: true, force: true });
});

describe("listAgentFiles", () => {
  it("lists both agents/ and agent/ definitions sorted by name", () => {
    write("agents", "reviewer", "---\ndescription: r\n---\n");
    write("agent", "legacy", "---\ndescription: l\ndisable: true\n---\n");

    const files = listAgentFiles();
    expect(files.map((f) => f.name)).toEqual(["legacy", "reviewer"]);
    expect(files[0].enabled).toBe(false);
    expect(files[1].enabled).toBe(true);
  });

  it("prefers agents/ when both directories define the same name", () => {
    write("agents", "dup", "canonical");
    write("agent", "dup", "shadowed");

    const files = listAgentFiles();
    expect(files).toHaveLength(1);
    expect(files[0].content).toBe("canonical");
  });

  it("skips names that cannot be safe file names", () => {
    write("agents", "ok", "x");
    fs.writeFileSync(path.join(base, "agents", "not ok.md"), "x", "utf8");

    expect(listAgentFiles().map((f) => f.name)).toEqual(["ok"]);
  });

  it("returns an empty list when the config dir does not exist", () => {
    process.env.OPENCODE_CONFIG_DIR = path.join(base, "missing");
    expect(listAgentFiles()).toEqual([]);
  });
});

describe("readAgentFile", () => {
  it("reports a missing definition without throwing", () => {
    const file = readAgentFile("nope");
    expect(file.exists).toBe(false);
    expect(file.content).toBe("");
    expect(file.enabled).toBe(true);
  });

  it("rejects unsafe names", () => {
    expect(() => readAgentFile("../escape")).toThrow(/英数字/);
  });
});

describe("writeAgentFile", () => {
  it("creates the agents/ directory on first write", () => {
    const file = writeAgentFile("fresh", "---\ndescription: f\n---\n");
    expect(file.exists).toBe(true);
    expect(
      fs.readFileSync(path.join(base, "agents", "fresh.md"), "utf8"),
    ).toContain("description: f");
  });

  it("updates an existing agent/ definition in place instead of forking it", () => {
    write("agent", "legacy", "old");

    writeAgentFile("legacy", "new");

    expect(fs.readFileSync(path.join(base, "agent", "legacy.md"), "utf8")).toBe(
      "new",
    );
    expect(fs.existsSync(path.join(base, "agents", "legacy.md"))).toBe(false);
  });

  it("rejects unsafe names", () => {
    expect(() => writeAgentFile("bad/name", "x")).toThrow(/英数字/);
  });
});

describe("setAgentFileEnabled", () => {
  it("flips `disable` in the frontmatter", () => {
    write("agents", "reviewer", "---\ndescription: r\n---\nbody\n");

    const disabled = setAgentFileEnabled("reviewer", false);
    expect(disabled.enabled).toBe(false);
    expect(disabled.content).toContain("disable: true");

    const enabled = setAgentFileEnabled("reviewer", true);
    expect(enabled.enabled).toBe(true);
    expect(enabled.content).toBe("---\ndescription: r\n---\nbody\n");
  });

  it("is a no-op when the state already matches", () => {
    const file = write("agents", "reviewer", "---\ndescription: r\n---\n");
    const before = fs.statSync(file).mtimeMs;

    setAgentFileEnabled("reviewer", true);

    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  it("fails for an agent without a definition file", () => {
    expect(() => setAgentFileEnabled("ghost", false)).toThrow(/見つかりません/);
  });
});

describe("deleteAgentFile", () => {
  it("removes the definition and ignores a missing one", () => {
    write("agents", "reviewer", "x");

    deleteAgentFile("reviewer");
    expect(fs.existsSync(path.join(base, "agents", "reviewer.md"))).toBe(false);

    expect(() => deleteAgentFile("reviewer")).not.toThrow();
  });
});
