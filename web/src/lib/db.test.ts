import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, test, expect } from "vitest";

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-db-"));
const previousAppData = process.env.APPDATA;
process.env.APPDATA = testDataDir;

const {
  bindSession,
  createWorkspace,
  getDb,
  touchSessionActivity,
  upsertProject,
} = await import("./db");

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
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
