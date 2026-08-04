import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDevcontainer, stripJsoncComments } from "./devcontainer";

describe("stripJsoncComments", () => {
  it("removes line comments", () => {
    const out = stripJsoncComments('{\n  // comment\n  "a": 1\n}');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it("removes trailing line comments", () => {
    const out = stripJsoncComments('{ "a": 1 // trailing\n}');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it("removes block comments", () => {
    const out = stripJsoncComments('{ /* block */ "a": 1 }');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it("preserves // inside string values (URLs)", () => {
    const out = stripJsoncComments('{ "image": "https://example.com/x" }');
    expect(JSON.parse(out)).toEqual({ image: "https://example.com/x" });
  });

  it("preserves /* */ inside string values", () => {
    const out = stripJsoncComments('{ "note": "a /* not a comment */ b" }');
    expect(JSON.parse(out)).toEqual({ note: "a /* not a comment */ b" });
  });

  it("handles escaped quotes within strings", () => {
    const out = stripJsoncComments('{ "q": "a\\"//b" }');
    expect(JSON.parse(out)).toEqual({ q: 'a"//b' });
  });

  it("keeps a realistic devcontainer.json with comments and a URL parseable", () => {
    const raw = [
      "{",
      '  // dev container',
      '  "name": "my-app",',
      '  "image": "mcr.microsoft.com/devcontainers/base:ubuntu", // base',
      '  "customizations": { "docs": "https://aka.ms/devcontainer" }',
      "}",
    ].join("\n");
    const parsed = JSON.parse(stripJsoncComments(raw));
    expect(parsed.name).toBe("my-app");
    expect(parsed.customizations.docs).toBe("https://aka.ms/devcontainer");
  });
});

describe("detectDevcontainer", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devcontainer-test-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeConfig(content: string) {
    fs.mkdirSync(path.join(root, ".devcontainer"));
    fs.writeFileSync(path.join(root, ".devcontainer", "devcontainer.json"), content);
  }

  it("reports no config found with parseError false", () => {
    expect(detectDevcontainer(root)).toEqual(
      expect.objectContaining({ present: false, parseError: false, name: null }),
    );
  });

  it("parses a config with a trailing comma (common hand-edited style)", () => {
    // Regression: JSON.parse alone rejects a trailing comma, which is common
    // enough in hand-edited devcontainer.json that it shouldn't be treated
    // as a parse failure.
    writeConfig('{\n  "name": "my-app",\n  "image": "ubuntu",\n}\n');
    const info = detectDevcontainer(root);
    expect(info).toEqual(
      expect.objectContaining({ present: true, name: "my-app", parseError: false }),
    );
  });

  it("distinguishes an unparsable config from a config with no name field", () => {
    writeConfig("{ this is not json");
    const broken = detectDevcontainer(root);
    expect(broken.name).toBeNull();
    expect(broken.parseError).toBe(true);

    fs.writeFileSync(path.join(root, ".devcontainer", "devcontainer.json"), "{}");
    const noName = detectDevcontainer(root);
    expect(noName.name).toBeNull();
    expect(noName.parseError).toBe(false);
  });
});
