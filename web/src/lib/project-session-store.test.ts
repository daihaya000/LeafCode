import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dataDir: "" }));
vi.mock("./paths", () => ({ dataDir: () => h.dataDir }));

import {
  MANIFEST_FILE,
  emptyManifest,
  legacyManifestDir,
  legacyManifestPath,
  manifestPath,
  parseManifest,
  projectKey,
  readProjectManifest,
  removeWorkspaceFromManifest,
  upsertWorkspaceInManifest,
  writeProjectManifest,
  type ManifestWorkspace,
} from "./project-session-store";

const ws = (id: string, overrides: Partial<ManifestWorkspace> = {}): ManifestWorkspace => ({
  id,
  displayName: `ws-${id}`,
  absolutePath: `/repo/${id}`,
  isolation: "git_worktree",
  baseBranch: "main",
  worktreePath: `/repo/.webui-worktrees/${id}`,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  sessions: [
    { opencodeSessionId: `ses_${id}`, title: `Session ${id}`, updatedAt: "2026-01-02T00:00:00.000Z" },
  ],
  ...overrides,
});

describe("manifest pure helpers", () => {
  it("emptyManifest carries project identity and version", () => {
    const m = emptyManifest({ name: "Demo", rootPath: "/repo" });
    expect(m.version).toBe(1);
    expect(m.project).toEqual({ name: "Demo", rootPath: "/repo" });
    expect(m.workspaces).toEqual([]);
  });

  it("upsert inserts then replaces by id", () => {
    let m = emptyManifest({ name: "Demo", rootPath: "/repo" });
    m = upsertWorkspaceInManifest(m, ws("a"));
    m = upsertWorkspaceInManifest(m, ws("b"));
    expect(m.workspaces.map((w) => w.id)).toEqual(["a", "b"]);
    m = upsertWorkspaceInManifest(m, ws("a", { displayName: "renamed" }));
    expect(m.workspaces).toHaveLength(2);
    expect(m.workspaces.find((w) => w.id === "a")?.displayName).toBe("renamed");
  });

  it("remove drops a workspace and is a no-op when absent", () => {
    let m = upsertWorkspaceInManifest(emptyManifest({ name: "D", rootPath: "/repo" }), ws("a"));
    const same = removeWorkspaceFromManifest(m, "missing");
    expect(same).toBe(m);
    m = removeWorkspaceFromManifest(m, "a");
    expect(m.workspaces).toHaveLength(0);
  });
});

describe("parseManifest (defensive)", () => {
  it("returns null for non-objects and missing rootPath", () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest("nope")).toBeNull();
    expect(parseManifest({ project: {} })).toBeNull();
  });

  it("skips malformed workspaces and sessions", () => {
    const parsed = parseManifest({
      project: { name: "D", rootPath: "/repo" },
      workspaces: [
        "bad",
        { id: "", absolutePath: "/x" },
        { id: "ok", absolutePath: "/repo/ok", sessions: ["bad", { title: "no id" }, { opencodeSessionId: "ses_1" }, { opencodeSessionId: "../../auth/openai" }] },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.workspaces).toHaveLength(1);
    const w = parsed!.workspaces[0];
    expect(w.id).toBe("ok");
    expect(w.sessions).toHaveLength(1);
    expect(w.sessions[0].opencodeSessionId).toBe("ses_1");
  });

  it("fills defaults for optional fields", () => {
    const parsed = parseManifest({
      project: { rootPath: "/repo" },
      workspaces: [{ id: "x", absolutePath: "/repo/x" }],
    });
    const w = parsed!.workspaces[0];
    expect(w.isolation).toBe("current_folder");
    expect(w.status).toBe("active");
    expect(w.baseBranch).toBeNull();
    expect(parsed!.project.name).toBe("repo");
  });
});

describe("fs round trip", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ocw-manifest-"));
    h.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocw-manifest-data-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(h.dataDir, { recursive: true, force: true });
  });

  it("writes to the machine-local data dir, never into the repo", () => {
    let m = emptyManifest({ name: "Demo", rootPath: root });
    m = upsertWorkspaceInManifest(m, ws("a"));
    writeProjectManifest(root, m);

    expect(manifestPath(root)).toBe(
      path.join(h.dataDir, "projects", projectKey(root), MANIFEST_FILE),
    );
    expect(fs.existsSync(manifestPath(root))).toBe(true);
    expect(fs.existsSync(path.join(root, ".opencode-webui"))).toBe(false);

    const back = readProjectManifest(root);
    expect(back).not.toBeNull();
    expect(back!.workspaces).toHaveLength(1);
    expect(back!.workspaces[0].sessions[0].opencodeSessionId).toBe("ses_a");
  });

  it("migrates a legacy in-repo manifest and removes it", () => {
    let m = emptyManifest({ name: "Demo", rootPath: root });
    m = upsertWorkspaceInManifest(m, ws("a"));
    fs.mkdirSync(legacyManifestDir(root), { recursive: true });
    fs.writeFileSync(legacyManifestPath(root), JSON.stringify(m), "utf8");

    const back = readProjectManifest(root);
    expect(back).not.toBeNull();
    expect(back!.workspaces).toHaveLength(1);
    expect(back!.workspaces[0].sessions[0].opencodeSessionId).toBe("ses_a");

    expect(fs.existsSync(manifestPath(root))).toBe(true);
    expect(fs.existsSync(path.join(root, ".opencode-webui"))).toBe(false);
  });

  it("leaves an unparsable legacy file untouched", () => {
    fs.mkdirSync(legacyManifestDir(root), { recursive: true });
    fs.writeFileSync(legacyManifestPath(root), "{not json", "utf8");

    expect(readProjectManifest(root)).toBeNull();
    expect(fs.existsSync(legacyManifestPath(root))).toBe(true);
  });

  it("returns null when no manifest exists", () => {
    expect(readProjectManifest(root)).toBeNull();
  });
});
