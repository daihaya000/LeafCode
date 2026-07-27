import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "jsonc-parser";
import {
  atomicWriteFile,
  detectFormatting,
  getPluginArray,
  insertPluginEntryInContent,
  parseJsoncConfig,
  readConfigContent,
  removePluginEntryInContent,
  setMcpEnabledInContent,
  updateConfigFile,
  withConfigLock,
} from "./jsonc-edit";

// Mirrors the real global opencode.jsonc shape: comments inside the plugin
// array and inside mcp entries, 2-space indent.
const SAMPLE = `{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    // NOTE: local plugins are auto-loaded from ./plugin/*.js instead.
    "opencode-claude-auth@latest",
    "opencode-qux@latest"
  ],
  "mcp": {
    // Requires uvx on PATH.
    "blender": {
      "type": "local",
      "command": ["uvx", "blender-mcp"],
      "enabled": true,
      "timeout": 200000
    },
    "off-server": {
      "type": "remote",
      "url": "https://example.com",
      "enabled": false
    }
  },
  "model": "openai/gpt-5.6-terra"
}
`;

describe("setMcpEnabledInContent", () => {
  it("disables a server without touching comments or other entries", () => {
    const out = setMcpEnabledInContent(SAMPLE, "blender", false);
    expect(parse(out)).toMatchObject({
      mcp: { blender: { enabled: false }, "off-server": { enabled: false } },
      model: "openai/gpt-5.6-terra",
    });
    // Only the blender enabled line changed.
    const diff = SAMPLE.split("\n").filter(
      (line, i) => line !== out.split("\n")[i],
    );
    expect(diff).toEqual(['      "enabled": true,']);
    expect(out).toContain("// Requires uvx on PATH.");
    expect(out).toContain("// NOTE: local plugins are auto-loaded");
  });

  it("enables a disabled server", () => {
    const out = setMcpEnabledInContent(SAMPLE, "off-server", true);
    expect(parse(out)).toMatchObject({
      mcp: { "off-server": { enabled: true } },
    });
  });

  it("adds enabled when the entry has no enabled field", () => {
    const src = `{
  "mcp": {
    "x": { "type": "local", "command": ["a"] }
  }
}`;
    const out = setMcpEnabledInContent(src, "x", false);
    // Adding a property may expand an inline object; values must survive.
    expect(parse(out)).toMatchObject({
      mcp: { x: { type: "local", command: ["a"], enabled: false } },
    });
  });

  it("returns the same content when nothing changes", () => {
    expect(setMcpEnabledInContent(SAMPLE, "blender", true)).toBe(SAMPLE);
    expect(setMcpEnabledInContent(SAMPLE, "off-server", false)).toBe(SAMPLE);
  });

  it("rejects unknown servers and missing mcp", () => {
    expect(() => setMcpEnabledInContent(SAMPLE, "nope", false)).toThrowError(
      /見つかりません/,
    );
    expect(() =>
      setMcpEnabledInContent('{ "model": "x" }', "nope", false),
    ).toThrowError(/設定されていません/);
  });
});

describe("plugin array edits", () => {
  it("removes an entry and preserves comments", () => {
    const { content, removed } = removePluginEntryInContent(SAMPLE, 0);
    expect(removed).toBe("opencode-claude-auth@latest");
    expect(getPluginArray(content)).toEqual(["opencode-qux@latest"]);
    expect(content).toContain("// NOTE: local plugins are auto-loaded");
    expect(content).toContain('"$schema"');
  });

  it("removes the last entry without leaving a dangling comma", () => {
    const { content } = removePluginEntryInContent(SAMPLE, 1);
    expect(getPluginArray(content)).toEqual(["opencode-claude-auth@latest"]);
    expect(content).not.toMatch(/,\s*\]/);
  });

  it("rejects out-of-range removal", () => {
    expect(() => removePluginEntryInContent(SAMPLE, 5)).toThrowError(
      /見つかりません/,
    );
  });

  it("inserts at the beginning, shifting existing entries", () => {
    const out = insertPluginEntryInContent(SAMPLE, 0, "new-plugin");
    expect(getPluginArray(out)).toEqual([
      "new-plugin",
      "opencode-claude-auth@latest",
      "opencode-qux@latest",
    ]);
    expect(out).toContain("// NOTE: local plugins are auto-loaded");
  });

  it("inserts in the middle", () => {
    const out = insertPluginEntryInContent(SAMPLE, 1, ["tuple-plugin", { a: 1 }]);
    expect(getPluginArray(out)).toEqual([
      "opencode-claude-auth@latest",
      ["tuple-plugin", { a: 1 }],
      "opencode-qux@latest",
    ]);
  });

  it("appends at the end and clamps large indexes", () => {
    const out = insertPluginEntryInContent(SAMPLE, 99, "tail");
    expect(getPluginArray(out)).toEqual([
      "opencode-claude-auth@latest",
      "opencode-qux@latest",
      "tail",
    ]);
  });

  it("inserts into an empty plugin array with matching indentation", () => {
    const src = `{
  "plugin": [],
  "model": "x"
}`;
    const out = insertPluginEntryInContent(src, 0, "only");
    expect(getPluginArray(out)).toEqual(["only"]);
    expect(out).toContain('\n    "only"\n');
  });

  it("creates the plugin array when missing", () => {
    const src = `{
  "model": "x"
}`;
    const out = insertPluginEntryInContent(src, 0, "first");
    expect(getPluginArray(out)).toEqual(["first"]);
    expect(parse(out)).toMatchObject({ model: "x" });
  });

  it("round-trips remove then insert at the same index", () => {
    const { content, removed } = removePluginEntryInContent(SAMPLE, 1);
    const restored = insertPluginEntryInContent(content, 1, removed);
    expect(getPluginArray(restored)).toEqual([
      "opencode-claude-auth@latest",
      "opencode-qux@latest",
    ]);
  });
});

describe("detectFormatting", () => {
  it("detects 2-space LF by default", () => {
    expect(detectFormatting(SAMPLE)).toEqual({
      insertSpaces: true,
      tabSize: 2,
      eol: "\n",
    });
  });

  it("detects CRLF and tabs", () => {
    const crlf = "{\r\n\t\"a\": 1\r\n}";
    expect(detectFormatting(crlf)).toEqual({
      insertSpaces: false,
      tabSize: 1,
      eol: "\r\n",
    });
  });
});

describe("parseJsoncConfig / readConfigContent", () => {
  it("parses comments and trailing commas", () => {
    const root = parseJsoncConfig('{ // c\n "a": 1, }');
    expect(root).toEqual({ a: 1 });
  });

  it("rejects non-object roots", () => {
    expect(() => parseJsoncConfig("[1,2]")).toThrowError(/不正です/);
  });

  it("raises a safe error for a missing file", () => {
    expect(() =>
      readConfigContent(path.join(os.tmpdir(), "definitely-missing.jsonc")),
    ).toThrowError(/見つかりません/);
  });
});

describe("atomicWriteFile", () => {
  let base: string;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "jsonc-edit-"));
  });
  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("writes the file and leaves no temp files behind", async () => {
    const target = path.join(base, "opencode.jsonc");
    await atomicWriteFile(target, "hello");
    expect(fs.readFileSync(target, "utf8")).toBe("hello");
    expect(fs.readdirSync(base)).toEqual(["opencode.jsonc"]);
  });

  it("creates parent directories", async () => {
    const target = path.join(base, "deep", "dir", "f.json");
    await atomicWriteFile(target, "{}");
    expect(fs.existsSync(target)).toBe(true);
  });
});

describe("updateConfigFile", () => {
  let base: string;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "jsonc-update-"));
  });
  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("re-reads, applies the minimal edit and writes atomically", async () => {
    const target = path.join(base, "opencode.jsonc");
    fs.writeFileSync(target, SAMPLE);

    await updateConfigFile(target, (content) =>
      setMcpEnabledInContent(content, "blender", false),
    );

    const out = fs.readFileSync(target, "utf8");
    expect(parse(out)).toMatchObject({
      mcp: { blender: { enabled: false }, "off-server": { enabled: false } },
    });
    expect(out).toContain("// Requires uvx on PATH.");
    expect(out).toContain("// NOTE: local plugins are auto-loaded");
  });

  it("does not write when the mutation leaves the content unchanged", async () => {
    const target = path.join(base, "opencode.jsonc");
    fs.writeFileSync(target, SAMPLE);
    const before = fs.statSync(target).mtimeMs;

    await updateConfigFile(target, (content) => content);

    expect(fs.readFileSync(target, "utf8")).toBe(SAMPLE);
    expect(fs.statSync(target).mtimeMs).toBe(before);
  });

  it("applies concurrent updates on fresh content without losing either", async () => {
    const target = path.join(base, "opencode.jsonc");
    fs.writeFileSync(target, SAMPLE);

    await Promise.all([
      updateConfigFile(target, (c) => setMcpEnabledInContent(c, "blender", false)),
      updateConfigFile(target, (c) => setMcpEnabledInContent(c, "off-server", true)),
    ]);

    expect(parse(fs.readFileSync(target, "utf8"))).toMatchObject({
      mcp: { blender: { enabled: false }, "off-server": { enabled: true } },
    });
  });
});

describe("withConfigLock", () => {
  it("serializes overlapping mutations", async () => {
    const order: string[] = [];
    const slow = withConfigLock(async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("a-end");
    });
    const fast = withConfigLock(async () => {
      order.push("b-start");
      order.push("b-end");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("keeps the queue alive after a failure", async () => {
    const failing = withConfigLock(async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrowError("boom");
    const next = await withConfigLock(async () => "ok");
    expect(next).toBe("ok");
  });
});
