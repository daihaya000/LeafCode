import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupStaleArtifacts,
  isValidProfileDir,
  readLinkState,
  removeLink,
  swapLink,
} from "./link";
import { PENDING_COPY_PREFIX, SWAP_LINK_PREFIX } from "./paths";

let sandbox: string;
let homeSpy: ReturnType<typeof vi.spyOn>;
let previousAppData: string | undefined;

/** A directory that passes `isValidProfileDir`. */
function makeConfigDir(dir: string, marker: string): string {
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), `{ "marker": "${marker}" }`);
  fs.writeFileSync(path.join(dir, "agents", "a.md"), `agent ${marker}`);
  return dir;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "profiles-link-"));
  // dataDir() resolves from APPDATA on win32 and homedir elsewhere.
  previousAppData = process.env.APPDATA;
  process.env.APPDATA = path.join(sandbox, "appdata");
  homeSpy = vi.spyOn(os, "homedir").mockReturnValue(sandbox);
  fs.mkdirSync(path.join(sandbox, "appdata", "opencode-webui", "profiles"), {
    recursive: true,
  });
});

afterEach(() => {
  homeSpy.mockRestore();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("readLinkState", () => {
  it("reports missing, realdir and link", () => {
    const link = path.join(sandbox, "opencode");
    expect(readLinkState(link).state).toBe("missing");

    fs.mkdirSync(link);
    expect(readLinkState(link).state).toBe("realdir");
    fs.rmdirSync(link);

    const target = makeConfigDir(path.join(sandbox, "A"), "A");
    fs.symlinkSync(target, link, "junction");
    const info = readLinkState(link);
    expect(info.state).toBe("link");
    expect(info.target && path.resolve(info.target)).toBe(path.resolve(target));
  });
});

describe("isValidProfileDir", () => {
  it("requires a recognisable OpenCode config marker", () => {
    const bare = path.join(sandbox, "bare");
    fs.mkdirSync(bare);
    expect(isValidProfileDir(bare)).toBe(false);
    expect(isValidProfileDir(makeConfigDir(path.join(sandbox, "ok"), "ok"))).toBe(
      true,
    );
  });
});

describe("removeLink", () => {
  it("detaches the link and leaves the target intact", () => {
    const target = makeConfigDir(path.join(sandbox, "A"), "A");
    const link = path.join(sandbox, "opencode");
    fs.symlinkSync(target, link, "junction");

    removeLink(link);

    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(path.join(target, "agents", "a.md"))).toBe(true);
  });
});

describe("swapLink", () => {
  it("repoints the link and preserves BOTH profiles' contents", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    const b = makeConfigDir(path.join(sandbox, "B"), "B");
    const link = path.join(sandbox, "opencode");
    fs.symlinkSync(a, link, "junction");

    swapLink(b, link);

    expect(path.resolve(readLinkState(link).target!)).toBe(path.resolve(b));
    // The whole point of the feature: switching must never destroy data.
    expect(fs.readFileSync(path.join(a, "agents", "a.md"), "utf8")).toBe("agent A");
    expect(fs.readFileSync(path.join(b, "agents", "a.md"), "utf8")).toBe("agent B");
    expect(
      JSON.parse(fs.readFileSync(path.join(link, "opencode.jsonc"), "utf8")).marker,
    ).toBe("B");
  });

  it("creates the link when nothing is there yet", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    const link = path.join(sandbox, "opencode");

    swapLink(a, link);

    expect(path.resolve(readLinkState(link).target!)).toBe(path.resolve(a));
  });

  it("refuses to replace a real directory", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    const link = makeConfigDir(path.join(sandbox, "opencode"), "REAL");

    expect(() => swapLink(a, link)).toThrow(/実体ディレクトリ/);

    // The user's real directory must be untouched.
    expect(fs.readFileSync(path.join(link, "agents", "a.md"), "utf8")).toBe(
      "agent REAL",
    );
  });

  it("refuses a target that is not a config directory", () => {
    const bare = path.join(sandbox, "bare");
    fs.mkdirSync(bare);
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    const link = path.join(sandbox, "opencode");
    fs.symlinkSync(a, link, "junction");

    expect(() => swapLink(bare, link)).toThrow(/設定ディレクトリ/);
    expect(path.resolve(readLinkState(link).target!)).toBe(path.resolve(a));
  });

  it("rolls back to the previous target when the rename fails", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    const b = makeConfigDir(path.join(sandbox, "B"), "B");
    const link = path.join(sandbox, "opencode");
    fs.symlinkSync(a, link, "junction");

    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("boom");
    });

    expect(() => swapLink(b, link)).toThrow("boom");
    renameSpy.mockRestore();

    // Restored to A, and no temporary junction left behind.
    expect(path.resolve(readLinkState(link).target!)).toBe(path.resolve(a));
    expect(
      fs.readdirSync(sandbox).filter((e) => e.startsWith(SWAP_LINK_PREFIX)),
    ).toHaveLength(0);
    expect(fs.existsSync(path.join(a, "agents", "a.md"))).toBe(true);
    expect(fs.existsSync(path.join(b, "agents", "a.md"))).toBe(true);
  });
});

describe("cleanupStaleArtifacts", () => {
  it("detaches stale swap links without deleting their targets", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    const stale = path.join(sandbox, `${SWAP_LINK_PREFIX}deadbeef`);
    fs.symlinkSync(a, stale, "junction");

    cleanupStaleArtifacts(path.join(sandbox, "opencode"));

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(path.join(a, "agents", "a.md"))).toBe(true);
  });

  it("removes unpublished copies without following links inside them", () => {
    const precious = makeConfigDir(path.join(sandbox, "precious"), "P");
    const profilesDir = path.join(
      sandbox,
      "appdata",
      "opencode-webui",
      "profiles",
    );
    const pending = path.join(profilesDir, `${PENDING_COPY_PREFIX}abc`);
    fs.mkdirSync(path.join(pending, "node_modules"), { recursive: true });
    // Mirrors the real config: node_modules contains links to a live directory.
    fs.symlinkSync(precious, path.join(pending, "node_modules", "pkg"), "junction");

    cleanupStaleArtifacts(path.join(sandbox, "opencode"));

    expect(fs.existsSync(pending)).toBe(false);
    // Deleting our temp copy must not follow the link into the real profile.
    expect(fs.readFileSync(path.join(precious, "agents", "a.md"), "utf8")).toBe(
      "agent P",
    );
  });

  it("leaves published profiles alone", () => {
    const profilesDir = path.join(
      sandbox,
      "appdata",
      "opencode-webui",
      "profiles",
    );
    const published = makeConfigDir(path.join(profilesDir, "work"), "W");

    cleanupStaleArtifacts(path.join(sandbox, "opencode"));

    expect(fs.existsSync(path.join(published, "opencode.jsonc"))).toBe(true);
  });
});
