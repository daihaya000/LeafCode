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
  getWorkspace,
  findWorkspaceIdsBySessionAndDirectory,
  createMemoryExtractionRun,
  completeMemoryExtractionRun,
  failMemoryExtractionRun,
  listMemoryExtractionRuns,
  countUnreadMemoryExtractionRuns,
  markMemoryExtractionRunsRead,
  claimAssistantMemoryExtraction,
  completeAssistantMemoryExtraction,
  releaseAssistantMemoryExtraction,
  MEMORY_ASSISTANT_EXTRACT_CLAIM_TTL_MS,
  listSessionBindings,
  primaryBindings,
  releaseSessionCompactionLock,
  setPrimarySession,
  setSessionFavorite,
  touchSessionActivity,
  tryAcquireSessionCompactionLock,
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

test("assistant memory extraction claims are durable, exclusive, and reclaimable", () => {
  const first = claimAssistantMemoryExtraction("ws-1", "ses-ledger", "msg-1", 10_000);
  expect(first).toMatchObject({
    workspaceId: "ws-1",
    sessionId: "ses-ledger",
    assistantMessageId: "msg-1",
    claimedAt: 10_000,
  });
  expect(claimAssistantMemoryExtraction("ws-1", "ses-ledger", "msg-1", 10_001)).toBeNull();
  expect(completeAssistantMemoryExtraction(first!)).toBe(true);
  expect(claimAssistantMemoryExtraction("ws-1", "ses-ledger", "msg-1", 20_000)).toBeNull();

  const retry = claimAssistantMemoryExtraction("ws-1", "ses-ledger", "msg-2", 30_000);
  expect(retry).not.toBeNull();
  expect(releaseAssistantMemoryExtraction(retry!)).toBe(true);
  expect(claimAssistantMemoryExtraction("ws-1", "ses-ledger", "msg-2", 30_001)).not.toBeNull();

  const stale = claimAssistantMemoryExtraction("ws-1", "ses-ledger", "msg-3", 40_000);
  expect(stale).not.toBeNull();
  const reclaimed = claimAssistantMemoryExtraction(
    "ws-1",
    "ses-ledger",
    "msg-3",
    40_000 + MEMORY_ASSISTANT_EXTRACT_CLAIM_TTL_MS + 1,
  );
  expect(reclaimed?.claimedAt).toBe(40_000 + MEMORY_ASSISTANT_EXTRACT_CLAIM_TTL_MS + 1);
});

test("memory extraction run history stores counts and unread state", () => {
  const completed = createMemoryExtractionRun({
    workspaceId: "ws-1",
    sourceSessionId: "ses-history",
    assistantMessageId: "msg-history",
    trigger: "assistant-completed",
    startedAt: 50_000,
  });
  expect(
    completeMemoryExtractionRun(
      completed,
      { created: 4, saved: 3, candidates: 1, rejected: 2, skipped: 1 },
      50_100,
    ),
  ).toBe(true);

  const failed = createMemoryExtractionRun({
    workspaceId: "ws-1",
    sourceSessionId: "ses-history",
    trigger: "manual",
    startedAt: 50_200,
  });
  expect(failMemoryExtractionRun(failed, "model timeout", 50_300)).toBe(true);

  expect(countUnreadMemoryExtractionRuns("ws-1")).toBe(2);
  expect(listMemoryExtractionRuns({ workspaceId: "ws-1", limit: 10 })).toMatchObject([
    {
      id: failed,
      trigger: "manual",
      status: "failed",
      error: "model timeout",
    },
    {
      id: completed,
      trigger: "assistant-completed",
      status: "completed",
      createdCount: 4,
      savedCount: 3,
      candidateCount: 1,
      rejectedCount: 2,
      skippedCount: 1,
    },
  ]);
  expect(markMemoryExtractionRunsRead("ws-1", 50_400)).toBe(2);
  expect(countUnreadMemoryExtractionRuns("ws-1")).toBe(0);
});

test("session compaction lock is exclusive per session", () => {
  expect(tryAcquireSessionCompactionLock("ses-lock-1", "owner-a", 1_000, 100)).toBe(true);
  expect(tryAcquireSessionCompactionLock("ses-lock-1", "owner-b", 1_050, 100)).toBe(false);
  expect(tryAcquireSessionCompactionLock("ses-lock-2", "owner-b", 1_050, 100)).toBe(true);
});

test("session compaction lock releases only for its owner", () => {
  expect(tryAcquireSessionCompactionLock("ses-lock-release", "owner-a", 2_000, 100)).toBe(true);
  expect(releaseSessionCompactionLock("ses-lock-release", "owner-b")).toBe(false);
  expect(tryAcquireSessionCompactionLock("ses-lock-release", "owner-b", 2_050, 100)).toBe(false);
  expect(releaseSessionCompactionLock("ses-lock-release", "owner-a")).toBe(true);
  expect(tryAcquireSessionCompactionLock("ses-lock-release", "owner-b", 2_050, 100)).toBe(true);
});

test("expired session compaction lock is reclaimed on the next acquire", () => {
  expect(tryAcquireSessionCompactionLock("ses-lock-expiry", "owner-a", 3_000, 100)).toBe(true);
  expect(tryAcquireSessionCompactionLock("ses-lock-expiry", "owner-b", 3_100, 100)).toBe(true);
  expect(releaseSessionCompactionLock("ses-lock-expiry", "owner-a")).toBe(false);
  expect(releaseSessionCompactionLock("ses-lock-expiry", "owner-b")).toBe(true);
});

test("session favorites are stored per workspace and ordered first", () => {
  bindSession("ws-1", "ses-2", "Second", "2026-07-22T12:00:00.000Z");
  expect(setSessionFavorite("ws-1", "ses-2", true)).toBe(true);
  bindSession("ws-1", "ses-2", "Second renamed", "2026-07-22T13:00:00.000Z");

  const sessions = listSessionBindings("ws-1");
  expect(sessions[0]).toMatchObject({
    opencode_session_id: "ses-2",
    title: "Second renamed",
    favorite: 1,
  });
  expect(setSessionFavorite("ws-1", "ses-2", false)).toBe(true);
  expect(listSessionBindings("ws-1").find((s) => s.opencode_session_id === "ses-2")?.favorite).toBe(0);
});

test("session workspace lookup is constrained to the request directory", () => {
  const rootPath = path.join(testDataDir, "directory-scope");
  const project = upsertProject({ name: "DirectoryScope", rootPath });
  createWorkspace({
    id: "ws-directory-scope",
    projectId: project.id,
    displayName: "Directory Scope",
    absolutePath: rootPath,
    isolation: "current_folder",
  });
  bindSession("ws-directory-scope", "ses-directory-scope", "Session");

  expect(
    findWorkspaceIdsBySessionAndDirectory("ses-directory-scope", rootPath),
  ).toEqual(["ws-directory-scope"]);
  expect(
    findWorkspaceIdsBySessionAndDirectory(
      "ses-directory-scope",
      path.join(testDataDir, "other-directory"),
    ),
  ).toEqual([]);
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

test("the first binding becomes primary and later bindings do not replace it", () => {
  const project = upsertProject({
    name: "Primary",
    rootPath: path.join(testDataDir, "primary"),
  });
  createWorkspace({
    id: "ws-primary",
    projectId: project.id,
    displayName: "Primary Workspace",
    absolutePath: testDataDir,
    isolation: "current_folder",
  });

  bindSession("ws-primary", "ses-implement", "Implement", "2026-07-22T10:00:00.000Z");
  bindSession("ws-primary", "ses-review", "Review", "2026-07-22T11:00:00.000Z");

  expect(
    (getDb().prepare("SELECT primary_session_id FROM workspaces WHERE id = ?").get("ws-primary") as {
      primary_session_id: string;
    }).primary_session_id,
  ).toBe("ses-implement");
  expect(primaryBindings().get("ws-primary")?.opencode_session_id).toBe("ses-implement");
});

test("setPrimarySession promotes a later binding for SessionSwitcher", () => {
  const project = upsertProject({
    name: "PrimarySwitch",
    rootPath: path.join(testDataDir, "primary-switch"),
  });
  createWorkspace({
    id: "ws-primary-switch",
    projectId: project.id,
    displayName: "Primary Switch Workspace",
    absolutePath: testDataDir,
    isolation: "current_folder",
  });

  bindSession(
    "ws-primary-switch",
    "ses-a",
    "A",
    "2026-07-22T10:00:00.000Z",
  );
  bindSession(
    "ws-primary-switch",
    "ses-b",
    "B",
    "2026-07-22T11:00:00.000Z",
  );

  const before = getWorkspace("ws-primary-switch");
  expect(before?.primary_session_id).toBe("ses-a");
  expect(
    setPrimarySession("ws-primary-switch", "ses-b", before!.revision),
  ).toBe(true);
  expect(getWorkspace("ws-primary-switch")?.primary_session_id).toBe("ses-b");
  expect(primaryBindings().get("ws-primary-switch")?.opencode_session_id).toBe(
    "ses-b",
  );
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
  getDb()
    .prepare(
      `INSERT INTO memories
        (id, workspace_id, kind, content, provenance, approved, created_at, updated_at)
       VALUES ('memory-fk', 'ws-fk', 'fact', 'cleanup me', 'manual', 1, 1, 1)`,
    )
    .run();
  getDb()
    .prepare(
      `INSERT INTO memory_audit_log
        (action, workspace_id, memory_id, created_at)
       VALUES ('create', 'ws-fk', 'memory-fk', 1)`,
    )
    .run();
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
  expect(getDb().prepare("SELECT * FROM memories WHERE id = 'memory-fk'").get()).toBeUndefined();
  expect(
    getDb().prepare("SELECT * FROM memory_audit_log WHERE memory_id = 'memory-fk'").get(),
  ).toBeUndefined();
});
