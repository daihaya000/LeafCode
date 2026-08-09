import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getJob, resetJobs } from "./jobs";
import { ensureRegistry } from "./registry";

// `spawnSync` is used to invoke PowerShell for Recycle Bin on Windows. Mock
// it so the tests don't actually touch the real Recycle Bin.
const spawnSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => {
  const mocked = { spawnSync: spawnSyncMock };
  // Some transitive import in this test's module graph uses the default
  // export form; without it vitest's interop throws "No default export is
  // defined on the mock" before any test runs.
  return { ...mocked, default: mocked };
});

import {
  activate,
  createProfile,
  listProfiles,
  migrateDefault,
  renameProfile,
  deleteProfile,
} from "./service";

let sandbox: string;
let homeSpy: ReturnType<typeof vi.spyOn>;
let previousAppData: string | undefined;
let previousConfigDir: string | undefined;

function makeConfigDir(dir: string, marker: string): string {
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), `{ "marker": "${marker}" }`);
  return dir;
}

function profilesDir(): string {
  return path.join(sandbox, "appdata", "opencode-webui", "profiles");
}

function waitForJob(jobId: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const job = getJob(jobId);
      if (!job) return reject(new Error("job disappeared"));
      if (job.state !== "running") return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
      setTimeout(check, 20);
    };
    check();
  });
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "profiles-service-"));
  previousAppData = process.env.APPDATA;
  previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
  delete process.env.OPENCODE_CONFIG_DIR;
  process.env.APPDATA = path.join(sandbox, "appdata");
  homeSpy = vi.spyOn(os, "homedir").mockReturnValue(sandbox);
  fs.mkdirSync(profilesDir(), { recursive: true });
  fs.mkdirSync(path.join(sandbox, ".config"), { recursive: true });
  resetJobs();
});

afterEach(() => {
  homeSpy.mockRestore();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
  else process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function linkPath(): string {
  return path.join(sandbox, ".config", "opencode");
}

function setupLink(target: string): void {
  fs.symlinkSync(target, linkPath(), "junction");
}

// ---------------------------------------------------------------------------
// listProfiles
// ---------------------------------------------------------------------------

describe("listProfiles", () => {
  it("registers the current link target as default and reports it active", async () => {
    const current = makeConfigDir(path.join(sandbox, "onedrive"), "D");
    setupLink(current);

    const result = await listProfiles();

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].name).toBe("default");
    expect(result.profiles[0].active).toBe(true);
    expect(result.profiles[0].external).toBe(true);
    expect(result.activeId).toBe(result.profiles[0].id);
    expect(result.linkState).toBe("link");
    // canSwitch reflects technical feasibility, not profile count.
    expect(result.canSwitch).toBe(true);
    expect(result.migration?.needed).toBe(true);
    expect(result.migration?.sourcePath).toBe(path.resolve(current));
  });

  it("reports canSwitch=true when multiple profiles exist", async () => {
    const current = makeConfigDir(path.join(sandbox, "onedrive"), "D");
    setupLink(current);
    await listProfiles(); // registers default

    // Create a second profile
    const second = makeConfigDir(path.join(profilesDir(), "work"), "W");
    const state = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    state.profiles.push({ id: "work-id", name: "work", path: second });
    fs.writeFileSync(
      path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
      JSON.stringify(state),
    );

    const result = await listProfiles();
    expect(result.profiles).toHaveLength(2);
    expect(result.canSwitch).toBe(true);
  });

  it("reports realdir and canSwitch=false", async () => {
    makeConfigDir(linkPath(), "REAL");

    const result = await listProfiles();

    expect(result.linkState).toBe("realdir");
    expect(result.canSwitch).toBe(false);
    expect(result.reason).toMatch(/実体ディレクトリ/);
    expect(result.migration?.needed).toBe(true);
  });

  it("migrates legacy provider cursor-acp → cursor across all profiles", async () => {
    const current = makeConfigDir(path.join(sandbox, "onedrive"), "D");
    fs.writeFileSync(
      path.join(current, "opencode.jsonc"),
      JSON.stringify({
        provider: {
          "cursor-acp": { name: "Cursor", models: { auto: {} } },
        },
      }),
    );
    setupLink(current);
    await listProfiles();

    // Add a second profile with the legacy key too.
    const second = makeConfigDir(path.join(profilesDir(), "work"), "W");
    fs.writeFileSync(
      path.join(second, "opencode.jsonc"),
      JSON.stringify({
        provider: {
          "cursor-acp": { name: "Cursor Work" },
        },
      }),
    );
    const state = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    state.profiles.push({ id: "work-id", name: "work", path: second });
    fs.writeFileSync(
      path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
      JSON.stringify(state),
    );

    await listProfiles();

    const currentConfig = JSON.parse(
      fs.readFileSync(path.join(current, "opencode.jsonc"), "utf8"),
    );
    expect(currentConfig.provider["cursor"].name).toBe("Cursor");
    expect(currentConfig.provider["cursor-acp"]).toBeUndefined();
    const secondConfig = JSON.parse(
      fs.readFileSync(path.join(second, "opencode.jsonc"), "utf8"),
    );
    expect(secondConfig.provider["cursor"].name).toBe("Cursor Work");
    expect(secondConfig.provider["cursor-acp"]).toBeUndefined();
  });

  it("reports OPENCODE_CONFIG_DIR override", async () => {
    const current = makeConfigDir(path.join(sandbox, "onedrive"), "D");
    setupLink(current);
    process.env.OPENCODE_CONFIG_DIR = path.join(sandbox, "override");

    const result = await listProfiles();

    expect(result.canSwitch).toBe(false);
    expect(result.reason).toMatch(/OPENCODE_CONFIG_DIR/);
  });
});

describe("createProfile", () => {
  it("creates and activates the first empty profile when the global link is missing", () => {
    const result = createProfile({ name: "default", from: "empty" });
    const created = result as { kind: "created"; profile: { active: boolean; path: string } };

    expect(created.kind).toBe("created");
    expect(fs.lstatSync(linkPath()).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(linkPath())).toBe(
      fs.realpathSync(created.profile.path),
    );
    expect(created.profile.active).toBe(true);
    expect(ensureRegistry().state.activeId).not.toBeNull();
  });

  it("does not replace an existing real config directory", () => {
    makeConfigDir(linkPath(), "REAL");

    const result = createProfile({ name: "work", from: "empty" });

    expect((result as { kind: string }).kind).toBe("created");
    expect(fs.lstatSync(linkPath()).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(linkPath(), "opencode.jsonc"), "utf8")).toContain("REAL");
  });
});

// ---------------------------------------------------------------------------
// activate
// ---------------------------------------------------------------------------

describe("activate", () => {
  it("switches the link and preserves both profiles", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    const b = makeConfigDir(path.join(sandbox, "B"), "B");
    setupLink(a);
    seedRegistry();

    // Register B manually
    const statePath = path.join(sandbox, "appdata", "opencode-webui", "profiles.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.profiles.push({ id: "b-id", name: "B", path: b });
    fs.writeFileSync(statePath, JSON.stringify(state));

    const result = activate("b-id");
    expect(result).toEqual({ ok: true });

    // Link now points to B
    const raw = fs.readlinkSync(linkPath());
    expect(path.resolve(raw)).toBe(path.resolve(b));

    // A's contents are intact
    expect(fs.readFileSync(path.join(a, "opencode.jsonc"), "utf8")).toContain("A");
  });

  it("returns 409 for a realdir", () => {
    makeConfigDir(linkPath(), "REAL");
    seedRegistry();

    const result = activate("any-id");
    expect(result).toMatchObject({ status: 409 });
    expect((result as { error: string }).error).toMatch(/実体ディレクトリ/);
  });

  it("returns 409 when OPENCODE_CONFIG_DIR is set", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    setupLink(a);
    seedRegistry();
    process.env.OPENCODE_CONFIG_DIR = path.join(sandbox, "override");

    const state = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    const result = activate(state.profiles[0].id);
    expect(result).toMatchObject({ status: 409 });
    expect((result as { error: string }).error).toMatch(/OPENCODE_CONFIG_DIR/);
  });

  it("returns 409 for an unknown profile id", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    setupLink(a);
    seedRegistry();

    const result = activate("nonexistent");
    expect(result).toMatchObject({ status: 409 });
  });

  it("returns 409 when the target directory is missing", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    setupLink(a);
    seedRegistry();

    const statePath = path.join(sandbox, "appdata", "opencode-webui", "profiles.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.profiles.push({ id: "ghost", name: "ghost", path: path.join(sandbox, "ghost") });
    fs.writeFileSync(statePath, JSON.stringify(state));

    const result = activate("ghost");
    expect(result).toMatchObject({ status: 409 });
    expect((result as { error: string }).error).toMatch(/認識できません/);
  });
});

// ---------------------------------------------------------------------------
// createProfile
// ---------------------------------------------------------------------------

describe("createProfile", () => {
  it("creates an empty profile synchronously", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    setupLink(a);
    seedRegistry();

    const result = createProfile({ name: "実験用", from: "empty" });

    expect(result).toMatchObject({ kind: "created" });
    const created = (result as { profile: { path: string; name: string } }).profile;
    expect(created.name).toBe("実験用");
    expect(fs.existsSync(path.join(created.path, "opencode.jsonc"))).toBe(true);
    expect(isInsideProfilesRoot(created.path)).toBe(true);
  });

  it("rejects an invalid name", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    setupLink(a);
    seedRegistry();

    const result = createProfile({ name: "", from: "empty" });
    expect(result).toMatchObject({ status: 409 });
  });

  it("starts a job when duplicating", async () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    fs.mkdirSync(path.join(a, ".git"), { recursive: true });
    fs.writeFileSync(path.join(a, ".git", "config"), "[core]");
    setupLink(a);
    seedRegistry();

    const state = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    const sourceId = state.profiles[0].id;

    const result = createProfile({ name: "copy", from: sourceId });
    expect(result).toMatchObject({ kind: "job" });

    const jobId = (result as { jobId: string }).jobId;
    await waitForJob(jobId);

    const job = getJob(jobId)!;
    expect(job.state).toBe("done");

    // .git is excluded from duplicates
    const freshState = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    const copyProfile = freshState.profiles.find(
      (p: { name: string }) => p.name === "copy",
    );
    expect(copyProfile).toBeDefined();
    expect(fs.existsSync(path.join(copyProfile.path, ".git"))).toBe(false);
    expect(fs.existsSync(path.join(copyProfile.path, "opencode.jsonc"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// migrateDefault
// ---------------------------------------------------------------------------

describe("migrateDefault", () => {
  it("copies default to dataDir, swaps the link, and keeps the source", async () => {
    const source = makeConfigDir(path.join(sandbox, "onedrive"), "D");
    fs.mkdirSync(path.join(source, "packages", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(source, "packages", "pkg", "index.js"), "{}");
    setupLink(source);
    seedRegistry();

    const result = migrateDefault();
    expect(result).toMatchObject({ jobId: expect.any(String) });

    await waitForJob((result as { jobId: string }).jobId);

    const job = getJob((result as { jobId: string }).jobId)!;
    expect(job.state).toBe("done");

    // Link now points to profiles/default
    const raw = fs.readlinkSync(linkPath());
    expect(path.resolve(raw)).toBe(path.resolve(path.join(profilesDir(), "default")));

    // Source is untouched
    expect(fs.existsSync(path.join(source, "opencode.jsonc"))).toBe(true);

    // Registry has both: old (backup) and new (default)
    const state = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    expect(state.profiles).toHaveLength(2);
    const backup = state.profiles.find((p: { name: string }) =>
      p.name.includes("バックアップ"),
    );
    const newDefault = state.profiles.find(
      (p: { name: string; external?: boolean }) => p.name === "default" && !p.external,
    );
    expect(backup).toBeDefined();
    expect(newDefault).toBeDefined();
    expect(state.activeId).toBe(newDefault.id);
  });

  it("moves default to dataDir and removes the source when requested", async () => {
    const source = makeConfigDir(path.join(sandbox, "onedrive"), "D");
    fs.mkdirSync(path.join(source, "packages"), { recursive: true });
    setupLink(source);
    seedRegistry();

    const result = migrateDefault("move");
    await waitForJob((result as { jobId: string }).jobId);

    const job = getJob((result as { jobId: string }).jobId)!;
    expect(job.state).toBe("done");
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.realpathSync(linkPath())).toBe(
      fs.realpathSync(path.join(profilesDir(), "default")),
    );

    const state = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].name).toBe("default");
    expect(state.profiles[0].external).toBeUndefined();
  });

  it("converts a legacy real directory into a junction during migration", async () => {
    const source = makeConfigDir(linkPath(), "REAL");
    fs.mkdirSync(path.join(source, "packages"), { recursive: true });

    const result = migrateDefault("move");
    await waitForJob((result as { jobId: string }).jobId);

    const job = getJob((result as { jobId: string }).jobId)!;
    expect(job.state).toBe("done");
    expect(fs.lstatSync(linkPath()).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(linkPath())).toBe(
      fs.realpathSync(path.join(profilesDir(), "default")),
    );

    const state = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].name).toBe("default");
  });

  it("returns 409 when there is no external active profile", async () => {
    // Already migrated: active is inside profilesRoot
    const inside = makeConfigDir(path.join(profilesDir(), "default"), "D");
    fs.mkdirSync(path.join(inside, "packages"), { recursive: true });
    setupLink(inside);
    seedRegistry();

    const result = migrateDefault();
    expect(result).toMatchObject({ status: 409 });
  });
});

// ---------------------------------------------------------------------------
// renameProfile / deleteProfile
// ---------------------------------------------------------------------------

describe("renameProfile", () => {
  it("updates the label without touching the directory", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    setupLink(a);
    seedRegistry();

    const state = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    const id = state.profiles[0].id;
    const originalPath = state.profiles[0].path;

    const result = renameProfile(id, "新しい名前");
    expect(result).toEqual({ ok: true });

    const updated = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    expect(updated.profiles[0].name).toBe("新しい名前");
    expect(updated.profiles[0].path).toBe(originalPath); // path unchanged
  });

  it("rejects an invalid name", () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    setupLink(a);
    seedRegistry();

    const state = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    const result = renameProfile(state.profiles[0].id, "");
    expect(result).toMatchObject({ status: 409 });
  });
});

describe("deleteProfile", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it("moves the directory to Recycle Bin and drops the registry entry (win32)", async () => {
    // On Windows, spawnSync (PowerShell) is mocked; pretend the recycle succeeded.
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });

    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    const b = makeConfigDir(path.join(sandbox, "B"), "B");
    setupLink(a);
    seedRegistry();

    const statePath = path.join(sandbox, "appdata", "opencode-webui", "profiles.json");
    let state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.profiles.push({ id: "b-id", name: "B", path: b });
    fs.writeFileSync(statePath, JSON.stringify(state));

    const result = await deleteProfile("b-id");
    expect(result).toEqual({ ok: true });

    // PowerShell recycle call invoked exactly once for the directory
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnSyncMock.mock.calls[0];
    expect(cmd).toBe("powershell.exe");
    expect(args.join(" ")).toContain("SendToRecycleBin");

    // Registry entry removed
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(state.profiles).toHaveLength(1);
  });

  it("permanently deletes when Recycle Bin is unavailable (fallback)", async () => {
    // On Windows, if the PowerShell recycle call fails, deleteProfile falls
    // back to a permanent fs.rmSync. Simulate that by having spawnSync report
    // a non-zero exit; the real fs.rmSync then removes the directory.
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "boom" });

    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    const b = makeConfigDir(path.join(sandbox, "B"), "B");
    setupLink(a);
    seedRegistry();

    const statePath = path.join(sandbox, "appdata", "opencode-webui", "profiles.json");
    let state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.profiles.push({ id: "b-id", name: "B", path: b });
    fs.writeFileSync(statePath, JSON.stringify(state));

    const result = await deleteProfile("b-id");
    expect(result).toEqual({ ok: true });

    // PowerShell recycle was attempted, then fell back to permanent delete
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(b, "opencode.jsonc"))).toBe(false);

    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(state.profiles).toHaveLength(1);
  });

  it("refuses to delete the active profile", async () => {
    const a = makeConfigDir(path.join(sandbox, "A"), "A");
    setupLink(a);
    seedRegistry();

    const state = JSON.parse(
      fs.readFileSync(
        path.join(sandbox, "appdata", "opencode-webui", "profiles.json"),
        "utf8",
      ),
    );
    const result = await deleteProfile(state.profiles[0].id);
    expect(result).toMatchObject({ status: 409 });
    expect((result as { error: string }).error).toMatch(/アクティブ/);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Seed the registry so subsequent service calls see the profiles. */
function seedRegistry(): void {
  ensureRegistry(linkPath());
}

function isInsideProfilesRoot(p: string): boolean {
  const rel = path.relative(profilesDir(), p);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}
