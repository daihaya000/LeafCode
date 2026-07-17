import { describe, expect, it } from "vitest";
import { stripJsoncComments } from "./devcontainer";

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
