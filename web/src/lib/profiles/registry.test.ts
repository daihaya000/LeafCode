import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureRegistry,
  makeProfile,
  readState,
  resolveActiveId,
  writeState,
} from "./registry";
import { profilesStatePath } from "./paths";

let sandbox: string;
let homeSpy: ReturnType<typeof vi.spyOn>;
let previousAppData: string | undefined;

function makeConfigDir(dir: string, marker: string): string {
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), `{ "marker": "${marker}" }`);
  return dir;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "profiles-registry-"));
  previousAppData = process.env.APPDATA;
  process.env.APPDATA = path.join(sandbox, "appdata");
  homeSpy = vi.spyOn(os, "homedir").mockReturnValue(sandbox);
  fs.mkdirSync(path.join(sandbox, "appdata", "leafcode", "profiles"), {
    recursive: true,
  });
});

afterEach(() => {
  homeSpy.mockRestore();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("readState / writeState", () => {
  it("round-trips and writes atomically without leaving temp files", () => {
    const state = {
      profiles: [makeProfile("default", path.join(sandbox, "A"))],
      activeId: null,
    };
    writeState(state);

    expect(readState().profiles[0].name).toBe("default");
    const dir = path.dirname(profilesStatePath());
    expect(fs.readdirSync(dir).filter((e) => e.includes(".tmp-"))).toHaveLength(0);
  });

  it("falls back to an empty state when the file is missing or corrupt", () => {
    expect(readState()).toEqual({ profiles: [], activeId: null });

    fs.mkdirSync(path.dirname(profilesStatePath()), { recursive: true });
    fs.writeFileSync(profilesStatePath(), "{ not json");
    expect(readState()).toEqual({ profiles: [], activeId: null });
  });

  it("returns an independent state on every call", () => {
    // Regression: a shared empty-state constant let one caller's push leak
    // into every later read, duplicating profiles across operations.
    const first = readState();
    first.profiles.push(makeProfile("leak", path.join(sandbox, "leak")));
    expect(readState().profiles).toHaveLength(0);
  });

  it("drops malformed entries", () => {
    fs.mkdirSync(path.dirname(profilesStatePath()), { recursive: true });
    fs.writeFileSync(
      profilesStatePath(),
      JSON.stringify({ profiles: [{ id: "x" }, null, 5], activeId: 7 }),
    );
    expect(readState()).toEqual({ profiles: [], activeId: null });
  });
});

describe("makeProfile", () => {
  it("tags directories outside profilesRoot as external", () => {
    const outside = makeProfile("default", path.join(sandbox, "A"));
    expect(outside.external).toBe(true);

    const inside = makeProfile(
      "work",
      path.join(sandbox, "appdata", "leafcode", "profiles", "work"),
    );
    expect(inside.external).toBeUndefined();
  });
});

describe("resolveActiveId", () => {
  it("follows the real link rather than the cached activeId", () => {
    const a = makeProfile("a", path.join(sandbox, "A"));
    const b = makeProfile("b", path.join(sandbox, "B"));
    const state = { profiles: [a, b], activeId: a.id };

    expect(
      resolveActiveId(state, { state: "link", target: path.join(sandbox, "B") }),
    ).toBe(b.id);
  });

  it("returns null when the link is missing or points somewhere unknown", () => {
    const a = makeProfile("a", path.join(sandbox, "A"));
    const state = { profiles: [a], activeId: a.id };

    expect(resolveActiveId(state, { state: "missing", target: null })).toBeNull();
    expect(
      resolveActiveId(state, { state: "link", target: path.join(sandbox, "Z") }),
    ).toBeNull();
  });
});

describe("ensureRegistry", () => {
  it("registers the current link target in place as default", () => {
    const current = makeConfigDir(path.join(sandbox, "onedrive-config"), "D");
    const link = path.join(sandbox, "opencode");
    fs.symlinkSync(current, link, "junction");

    const { state } = ensureRegistry(link);

    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].name).toBe("default");
    expect(path.resolve(state.profiles[0].path)).toBe(path.resolve(current));
    // Registered in place: it lives outside profilesRoot and was not moved.
    expect(state.profiles[0].external).toBe(true);
    expect(fs.existsSync(path.join(current, "opencode.jsonc"))).toBe(true);
    expect(state.activeId).toBe(state.profiles[0].id);
  });

  it("is idempotent", () => {
    const current = makeConfigDir(path.join(sandbox, "cfg"), "D");
    const link = path.join(sandbox, "opencode");
    fs.symlinkSync(current, link, "junction");

    const first = ensureRegistry(link).state;
    const second = ensureRegistry(link).state;

    expect(second.profiles).toHaveLength(1);
    expect(second.profiles[0].id).toBe(first.profiles[0].id);
  });

  it("reconciles a stale activeId with the real link", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    const b = makeConfigDir(path.join(sandbox, "B"), "B");
    const link = path.join(sandbox, "opencode");
    fs.symlinkSync(a, link, "junction");
    ensureRegistry(link);

    // Something outside the WebUI repoints the link.
    fs.rmdirSync(link);
    fs.symlinkSync(b, link, "junction");

    const { state } = ensureRegistry(link);
    const active = state.profiles.find((p) => p.id === state.activeId);
    expect(path.resolve(active!.path)).toBe(path.resolve(b));
  });

  it("registers nothing when the config dir is a real directory", () => {
    const link = makeConfigDir(path.join(sandbox, "opencode"), "REAL");

    const { state, link: info } = ensureRegistry(link);

    expect(info.state).toBe("realdir");
    expect(state.profiles).toHaveLength(0);
  });
});
