import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "jsonc-parser";

const h = vi.hoisted(() => ({
  dataDir: "",
  /** Gate to hold a config write mid-transaction (state written, config pending). */
  hold: {
    active: false,
    reached: null as (() => void) | null,
    release: null as (() => void) | null,
  },
}));

vi.mock("@/lib/paths", () => ({
  dataDir: () => h.dataDir,
  ensureDataDir: () => undefined,
}));

vi.mock("./jsonc-edit", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./jsonc-edit")>();
  return {
    ...orig,
    atomicWriteFile: async (filePath: string, content: string) => {
      if (h.hold.active && filePath.endsWith("opencode.jsonc")) {
        h.hold.reached?.();
        await new Promise<void>((resolve) => {
          h.hold.release = resolve;
        });
      }
      return orig.atomicWriteFile(filePath, content);
    },
  };
});

import { listPlugins, setPluginEnabled } from "./plugins";

const CONFIG = `{
  // top comment
  "plugin": [
    // NOTE: local plugins load from ./plugin/*.js
    "opencode-claude-auth@latest",
    ["opencode-bar", { "token": "s3cret" }],
    "@bybrawe/opencode-loop@latest"
  ],
  "mcp": {}
}
`;

let base: string;
let data: string;

function readConfig(): Record<string, unknown> {
  return parse(
    fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8"),
  ) as Record<string, unknown>;
}

function statePath(): string {
  return path.join(data, "opencode-extensions.json");
}

function readState(): { disabledPlugins: { id: string; value: unknown; index: number }[] } {
  return JSON.parse(fs.readFileSync(statePath(), "utf8"));
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "plugins-svc-cfg-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "plugins-svc-data-"));
  process.env.OPENCODE_CONFIG_DIR = base;
  h.dataDir = data;
  fs.writeFileSync(path.join(base, "opencode.jsonc"), CONFIG);
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  h.hold.active = false;
  h.hold.reached = null;
  h.hold.release = null;
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
});

describe("listPlugins", () => {
  it("lists configured plugins, including tuple form, without leaking options", async () => {
    const plugins = await listPlugins();
    const configured = plugins.filter((p) => p.kind === "config");
    expect(configured.map((p) => p.name)).toEqual([
      "opencode-claude-auth@latest",
      "opencode-bar",
      "@bybrawe/opencode-loop@latest",
    ]);
    expect(configured.every((p) => p.enabled)).toBe(true);
    expect(configured[1].hasOptions).toBe(true);
    expect(configured[0].hasOptions).toBeUndefined();
    expect(JSON.stringify(plugins)).not.toContain("s3cret");
  });

  it("lists local auto-loaded plugins from plugin/ and plugin-disabled/", async () => {
    fs.mkdirSync(path.join(base, "plugin"));
    fs.mkdirSync(path.join(base, "plugin-disabled"));
    fs.writeFileSync(path.join(base, "plugin", "cursor-acp.js"), "x");
    fs.writeFileSync(path.join(base, "plugin", "README.md"), "x");
    fs.mkdirSync(path.join(base, "plugin", "subdir.js"));
    fs.writeFileSync(path.join(base, "plugin-disabled", "old.ts"), "x");

    const plugins = await listPlugins();
    const local = plugins.filter((p) => p.kind === "local");
    expect(local).toEqual([
      { id: "local:cursor-acp.js", name: "cursor-acp.js", kind: "local", enabled: true },
      { id: "local:old.ts", name: "old.ts", kind: "local", enabled: false },
    ]);
  });

  it("diagnoses a corrupt state file and falls back to empty state", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fs.writeFileSync(statePath(), "{ corrupted");
      const plugins = await listPlugins();
      // The listing still works; configured plugins come from the config.
      expect(plugins.filter((p) => p.kind === "config")).toHaveLength(3);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("shows disabled configured plugins as WebUI-managed", async () => {
    const plugins = await listPlugins();
    const target = plugins.find((p) => p.name === "opencode-claude-auth@latest");
    expect(target).toBeTruthy();
    await setPluginEnabled(target!.id, false);

    const after = await listPlugins();
    const disabled = after.find((p) => p.name === "opencode-claude-auth@latest");
    expect(disabled).toMatchObject({
      kind: "config",
      enabled: false,
      managedByWebui: true,
    });
  });
});

describe("configured plugin toggles", () => {
  it("disables by removing the entry and recording value+index in state", async () => {
    const plugins = await listPlugins();
    const target = plugins.find((p) => p.name === "opencode-claude-auth@latest")!;

    await setPluginEnabled(target.id, false);

    expect(readConfig().plugin).toEqual([
      ["opencode-bar", { token: "s3cret" }],
      "@bybrawe/opencode-loop@latest",
    ]);
    // Comments survive the removal.
    const raw = fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8");
    expect(raw).toContain("// top comment");
    expect(raw).toContain("// NOTE: local plugins load from ./plugin/*.js");

    const state = readState();
    expect(state.disabledPlugins).toHaveLength(1);
    expect(state.disabledPlugins[0].value).toBe("opencode-claude-auth@latest");
    expect(state.disabledPlugins[0].index).toBe(0);
  });

  it("re-enables at the original position", async () => {
    const plugins = await listPlugins();
    const target = plugins.find((p) => p.name === "@bybrawe/opencode-loop@latest")!;
    await setPluginEnabled(target.id, false);
    expect(readConfig().plugin).toHaveLength(2);

    const afterDisable = await listPlugins();
    const disabled = afterDisable.find(
      (p) => p.name === "@bybrawe/opencode-loop@latest",
    )!;
    expect(disabled.enabled).toBe(false);

    await setPluginEnabled(disabled.id, true);

    expect(readConfig().plugin).toEqual([
      "opencode-claude-auth@latest",
      ["opencode-bar", { token: "s3cret" }],
      "@bybrawe/opencode-loop@latest",
    ]);
    expect(readState().disabledPlugins).toHaveLength(0);
  });

  it("round-trips tuple values exactly", async () => {
    const plugins = await listPlugins();
    const tuple = plugins.find((p) => p.name === "opencode-bar")!;
    await setPluginEnabled(tuple.id, false);

    const afterDisable = await listPlugins();
    const disabled = afterDisable.find((p) => p.name === "opencode-bar")!;
    await setPluginEnabled(disabled.id, true);

    expect(readConfig().plugin).toEqual([
      "opencode-claude-auth@latest",
      ["opencode-bar", { token: "s3cret" }],
      "@bybrawe/opencode-loop@latest",
    ]);
  });

  it("clamps the restore index when the array shrank", async () => {
    const plugins = await listPlugins();
    const target = plugins.find((p) => p.name === "@bybrawe/opencode-loop@latest")!;
    await setPluginEnabled(target.id, false);

    // Manually remove another entry → array is now shorter than the saved index.
    const raw = fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8");
    fs.writeFileSync(
      path.join(base, "opencode.jsonc"),
      raw.replace(/\s*\["opencode-bar",[\s\S]*?\},?\]/, ""),
    );
    expect(readConfig().plugin).toEqual(["opencode-claude-auth@latest"]);

    const afterDisable = await listPlugins();
    const disabled = afterDisable.find(
      (p) => p.name === "@bybrawe/opencode-loop@latest",
    )!;
    await setPluginEnabled(disabled.id, true);

    expect(readConfig().plugin).toEqual([
      "opencode-claude-auth@latest",
      "@bybrawe/opencode-loop@latest",
    ]);
  });

  it("reconciles state when the value was manually re-added to config", async () => {
    const plugins = await listPlugins();
    const target = plugins.find((p) => p.name === "opencode-claude-auth@latest")!;
    await setPluginEnabled(target.id, false);
    expect(readState().disabledPlugins).toHaveLength(1);

    // Simulate the user re-adding the plugin by hand.
    const raw = fs.readFileSync(path.join(base, "opencode.jsonc"), "utf8");
    fs.writeFileSync(
      path.join(base, "opencode.jsonc"),
      raw.replace(
        '"plugin": [',
        '"plugin": [\n    "opencode-claude-auth@latest",',
      ),
    );

    const after = await listPlugins();
    const matches = after.filter(
      (p) => p.name === "opencode-claude-auth@latest",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].enabled).toBe(true);
    expect(readState().disabledPlugins).toHaveLength(0);
  });

  it("rejects unknown or malformed ids", async () => {
    await expect(
      setPluginEnabled("config:0000000000000000.9", false),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(setPluginEnabled("config:zzz.0", false)).rejects.toMatchObject({
      code: "invalid-name",
    });
    await expect(setPluginEnabled("config:abcd", false)).rejects.toMatchObject({
      code: "invalid-name",
    });
    await expect(setPluginEnabled("", false)).rejects.toMatchObject({
      code: "invalid-name",
    });
  });

  it("rejects enabling an entry missing from state", async () => {
    await expect(
      setPluginEnabled("config:0000000000000000.0", true),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("concurrent operations", () => {
  it("serializes concurrent disables of different plugins without losing either", async () => {
    const plugins = await listPlugins();
    const a = plugins.find((p) => p.name === "opencode-claude-auth@latest")!;
    const b = plugins.find((p) => p.name === "@bybrawe/opencode-loop@latest")!;

    await Promise.all([
      setPluginEnabled(a.id, false),
      setPluginEnabled(b.id, false),
    ]);

    expect(readConfig().plugin).toEqual([["opencode-bar", { token: "s3cret" }]]);
    expect(readState().disabledPlugins.map((e) => e.value).sort()).toEqual([
      "@bybrawe/opencode-loop@latest",
      "opencode-claude-auth@latest",
    ]);
  });

  it("a concurrent listing cannot drop an in-flight disable record", async () => {
    const plugins = await listPlugins();
    const target = plugins.find((p) => p.name === "opencode-claude-auth@latest")!;

    // Hold the disable mid-transaction: its state record is written but the
    // config removal is still pending — the exact window where a listing
    // with a stale pre-lock config read used to prune the fresh record.
    h.hold.active = true;
    const reached = new Promise<void>((resolve) => {
      h.hold.reached = resolve;
    });
    const disable = setPluginEnabled(target.id, false);
    await reached;

    // Must serialize behind the in-flight disable, never observing the
    // transient "record + value still in config" state.
    const listing = listPlugins();

    h.hold.release?.();
    h.hold.active = false;
    await Promise.all([disable, listing]);

    expect(readState().disabledPlugins).toHaveLength(1);
    expect(readConfig().plugin).toHaveLength(2);
    const after = await listPlugins();
    expect(
      after.find((p) => p.name === "opencode-claude-auth@latest"),
    ).toMatchObject({ enabled: false, managedByWebui: true });
  });
});

describe("local plugin toggles", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(base, "plugin"));
    fs.writeFileSync(path.join(base, "plugin", "cursor-acp.js"), "export {}");
  });

  it("moves plugin/<file> to plugin-disabled/<file> and back", async () => {
    await setPluginEnabled("local:cursor-acp.js", false);
    expect(fs.existsSync(path.join(base, "plugin", "cursor-acp.js"))).toBe(false);
    expect(
      fs.readFileSync(path.join(base, "plugin-disabled", "cursor-acp.js"), "utf8"),
    ).toBe("export {}");

    await setPluginEnabled("local:cursor-acp.js", true);
    expect(
      fs.readFileSync(path.join(base, "plugin", "cursor-acp.js"), "utf8"),
    ).toBe("export {}");
    expect(
      fs.existsSync(path.join(base, "plugin-disabled", "cursor-acp.js")),
    ).toBe(false);
  });

  it("fails on conflict without losing either file", async () => {
    fs.mkdirSync(path.join(base, "plugin-disabled"));
    fs.writeFileSync(path.join(base, "plugin-disabled", "cursor-acp.js"), "other");

    await expect(
      setPluginEnabled("local:cursor-acp.js", false),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      fs.readFileSync(path.join(base, "plugin", "cursor-acp.js"), "utf8"),
    ).toBe("export {}");
    expect(
      fs.readFileSync(path.join(base, "plugin-disabled", "cursor-acp.js"), "utf8"),
    ).toBe("other");
  });

  it("rejects traversal and non-plugin names", async () => {
    await expect(setPluginEnabled("local:../opencode.jsonc", false)).rejects.toMatchObject({
      code: "invalid-name",
    });
    await expect(setPluginEnabled("local:readme.txt", false)).rejects.toMatchObject({
      code: "invalid-name",
    });
    await expect(setPluginEnabled("local:.hidden.js", false)).rejects.toMatchObject({
      code: "invalid-name",
    });
  });

  it("reports missing files as not-found", async () => {
    await expect(setPluginEnabled("local:ghost.js", false)).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
