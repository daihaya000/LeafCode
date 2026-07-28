import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, test, expect, vi } from "vitest";

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-db-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const {
  bindSession,
  createWorkspace,
  deleteProject,
  getDb,
  touchSessionActivity,
  upsertProject,
} = await import("./db");

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

test("touchSessionActivity updates only the matching binding", () => {
  expect(touchSessionActivity).toBeDefined();
  const project = upsertProject({ name: "Project", rootPath: testDataDir });
  createWorkspace({
    id: "ws-1",
    projectId: project.id,
    displayName: "Workspace",
    absolutePath: testDataDir,
    isolation: "current_folder",
  });
  bindSession("ws-1", "ses-1", "Session", "2026-07-22T10:00:00.000Z");
  expect(
    touchSessionActivity("ws-1", "ses-1", "2026-07-22T11:00:00.000Z"),
  ).toBe(true);
  expect(
    (
      getDb()
        .prepare(
          "SELECT updated_at FROM session_bindings WHERE workspace_id = ? AND opencode_session_id = ?",
        )
        .get("ws-1", "ses-1") as { updated_at: string }
    ).updated_at,
  ).toBe("2026-07-22T11:00:00.000Z");
  expect(touchSessionActivity("ws-2", "ses-1", "t2")).toBe(false);
});

test("bindSession throws on unsafe opencode_session_id (R22)", () => {
  const project = upsertProject({ name: "Unsafe", rootPath: path.join(testDataDir, "unsafe") });
  createWorkspace({
    id: "ws-unsafe",
    projectId: project.id,
    displayName: "Workspace",
    absolutePath: testDataDir,
    isolation: "current_folder",
  });
  // Unsafe id with path traversal attempt
  expect(() => bindSession("ws-unsafe", "../evil", "Session")).toThrow(
    /unsafe opencode_session_id/,
  );
});

test("upsertProject does not update last_opened_at when toggling favorite", () => {
  const rootPath = path.join(testDataDir, "fav-test");
  // Create initial project
  const initial = upsertProject({ name: "FavTest", rootPath });
  const initialLastOpened = initial.last_opened_at;

  // Wait a bit to ensure timestamp would differ if updated
  const waitMs = 10;
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    // busy wait
  }

  // Toggle favorite (explicit favorite=true should NOT update last_opened_at)
  const updated = upsertProject({ name: "FavTest", rootPath, favorite: true });
  expect(updated.favorite).toBe(1);
  expect(updated.last_opened_at).toBe(initialLastOpened);

  // Open without favorite toggle (favorite=undefined SHOULD update last_opened_at)
  const opened = upsertProject({ name: "FavTest", rootPath });
  expect(opened.last_opened_at).not.toBe(initialLastOpened);
});

test("foreign_keys pragma is ON so ON DELETE CASCADE fires", () => {
  // The DB initialization must enable foreign_keys; otherwise the REFERENCES
  // ... ON DELETE CASCADE clauses are silently ignored by SQLite.
  const row = getDb().prepare("PRAGMA foreign_keys").get() as { foreign_keys?: number };
  expect(row.foreign_keys).toBe(1);

  // Verify cascade behavior end-to-end: deleting a project removes its
  // workspace, which removes the workspace's session binding.
  const rootPath = path.join(testDataDir, "fk-cascade");
  const project = upsertProject({ name: "FkCascade", rootPath });
  createWorkspace({
    id: "ws-fk",
    projectId: project.id,
    displayName: "FkWs",
    absolutePath: rootPath,
    isolation: "current_folder",
  });
  bindSession("ws-fk", "ses-fk", "Session", "2026-07-22T10:00:00.000Z");
  expect(getDb().prepare("SELECT * FROM workspaces WHERE id = ?").get("ws-fk")).toBeTruthy();
  expect(
    getDb()
      .prepare("SELECT * FROM session_bindings WHERE workspace_id = ?")
      .get("ws-fk"),
  ).toBeTruthy();

  deleteProject(project.id);
  expect(getDb().prepare("SELECT * FROM workspaces WHERE id = ?").get("ws-fk")).toBeUndefined();
  expect(
    getDb()
      .prepare("SELECT * FROM session_bindings WHERE workspace_id = ?")
      .get("ws-fk"),
  ).toBeUndefined();
});
